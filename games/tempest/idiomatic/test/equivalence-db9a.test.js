// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for stepVectorPhaseAnimation -- advances a phase counter (gated by a frame byte), picks a slot from
// three parallel tables to seed two output cells, and emits three header words via dissolved emitCoordinateVectorWord /
// emitVectorWordTag70. Live-out is memory only, so each arm runs on a clone and compares RAM (dumpState minus
// stack scratch below the entry SP). Run: node --test games/tempest/idiomatic/test/equivalence-db9a.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db9a } from "../../translated/loc_db9a.js";
import { stepVectorPhaseAnimation } from "../stepVectorPhaseAnimation.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { FRAME_COUNTER, loc_39, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdb9a;
const oracle = atEntry(loc_db9a);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdb9a dispatches -- stepVectorPhaseAnimation == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); stepVectorPhaseAnimation(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// frame gate CLEAR (low six bits zero) -> the counter advances; a distinct $39 selects a table slot.
function seedAdvance(m) {
  m.mem.write8(FRAME_COUNTER, 0x00);   // (& 0x3f) == 0 -> increment $39
  m.mem.write8(loc_39, 0x02);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20);
}
// frame gate SET -> the counter is frozen; a different slot index.
function seedFrozen(m) {
  m.mem.write8(FRAME_COUNTER, 0x25);   // (& 0x3f) != 0 -> $39 unchanged
  m.mem.write8(loc_39, 0x05);
  m.mem.write8(DRAW_CURSOR_LO, 0x10); m.mem.write8(DRAW_CURSOR_HI, 0x20);
}

test("CRAFTED (advance): counter steps, slot seeded, words emitted -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedAdvance(o);
  const c = new Machine(ROM, OPTS); seedAdvance(c);
  oracle(o); stepVectorPhaseAnimation(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after advance");
  assert.equal(c.mem.read8(loc_39), 0x03, "$39 advanced");
});

test("CRAFTED (frozen gate): counter held, other slot -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seedFrozen(o);
  const c = new Machine(ROM, OPTS); seedFrozen(c);
  oracle(o); stepVectorPhaseAnimation(c);
  assert.equal(ramDiff(o, c), null, "RAM equal with gate set");
  assert.equal(c.mem.read8(loc_39), 0x05, "$39 held");
});

test("TEETH: a twin that never advances the counter diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedAdvance(o);
  const c = new Machine(ROM, OPTS); seedAdvance(c);
  oracle(o);
  const broken = (m) => { stepVectorPhaseAnimation; /* BUG: leaves $39 and the output cells untouched */ void m; };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the frozen counter");
});

test("SP-TOOTH: the tail-dispatching rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedAdvance(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, stepVectorPhaseAnimation, TARGET, m);
  assert.equal(r.placeable, true, `stepVectorPhaseAnimation must be seam-placeable; got: ${r.error}`);
});
