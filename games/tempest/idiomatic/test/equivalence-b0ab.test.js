// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for nudgeBlasterRimPosition (ROM 0xb0ab) -- reads $0200, nudges it through foldStepIntoFraction, clamps the
// result into [0, $0127], and writes it back to $0200 and to the A/Y live-outs. The oracle m.calls the
// translated adce; the idiomatic dissolves it into a direct idiomatic call, capturing its return. Both
// are memory-equivalent, so each arm compares RAM (dumpState, minus stack scratch below the entry SP) AND the A/Y live-outs
// (o.regs vs c.regs). No POKEY read -> deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b0ab.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b0ab } from "../../translated/loc_b0ab.js";
import { nudgeBlasterRimPosition } from "../nudgeBlasterRimPosition.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SPINNER_ACCUM, RIM_ROT_OFFSET, DEPTH_CEILING, PLAYER_SEGMENT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const rd = (n) => new Uint8Array(readFileSync(new URL(n, ROM_DIR)));
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? rd("maincpu.bin") : null;
const opt = (n) => (existsSync(new URL(n, ROM_DIR)) ? rd(n) : undefined);
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb0ab;
const oracle = atEntry(loc_b0ab);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

function seeded(v, step, s51, ceil) {
  const m = new Machine(ROM, OPTS);
  m.mem.write8(PLAYER_SEGMENT, v);
  m.mem.write8(SPINNER_ACCUM, step);
  m.mem.write8(RIM_ROT_OFFSET, s51);
  m.mem.write8(DEPTH_CEILING, ceil);
  return m;
}

test("CAPTURE: real 0xb0ab dispatches -- nudgeBlasterRimPosition == oracle in RAM (-stack) + A/Y live-outs", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const [ra, ry] = nudgeBlasterRimPosition(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out");
    assert.equal(c.regs.y, o.regs.y, "Y live-out");
    assert.equal(ra, o.regs.a, "return[0] == A live-out");
    assert.equal(ry, o.regs.y, "return[1] == Y live-out");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: keep / clamp-to-ceiling / negative-floors-to-zero (== oracle, RAM + A/Y)", () => {
  const cases = [
    { v: 0x10, step: 0x02, s51: 0x00, ceil: 0x50, want: 0x10 }, // in window -> keep
    { v: 0x40, step: 0x30, s51: 0x00, ceil: 0x20, want: 0x20 }, // above ceiling -> clamp
    { v: 0x90, step: 0x00, s51: 0x00, ceil: 0x50, want: 0x00 }, // negative -> zero
  ];
  for (const { v, step, s51, ceil, want } of cases) {
    const o = seeded(v, step, s51, ceil), c = seeded(v, step, s51, ceil);
    oracle(o); const [ra, ry] = nudgeBlasterRimPosition(c);
    assert.equal(ramDiff(o, c), null, `RAM v=0x${v.toString(16)}`);
    assert.equal(c.mem.read8(PLAYER_SEGMENT), want, `$0200 v=0x${v.toString(16)}`);
    assert.equal(c.regs.a, o.regs.a, `A v=0x${v.toString(16)}`);
    assert.equal(c.regs.y, o.regs.y, `Y v=0x${v.toString(16)}`);
    assert.equal(ra, o.regs.a, `return[0] v=0x${v.toString(16)}`);
    assert.equal(ry, o.regs.y, `return[1] v=0x${v.toString(16)}`);
  }
});

test("TEETH: a twin that skips the ceiling clamp diverges", () => {
  const o = seeded(0x40, 0x30, 0x00, 0x20); oracle(o);
  const c = seeded(0x40, 0x30, 0x00, 0x20); nudgeBlasterRimPosition(c);
  c.mem.write8(PLAYER_SEGMENT, 0x41); // BUG: unclamped result
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch a missing clamp");
});

test("TEETH(reg): the Y live-out differs from the stale pre-call value", () => {
  const c = seeded(0x40, 0x30, 0x00, 0x20);
  const yBefore = c.regs.y;
  const o = seeded(0x40, 0x30, 0x00, 0x20); oracle(o);
  assert.notEqual(yBefore, o.regs.y, "a twin that never publishes Y would keep the stale value");
});
