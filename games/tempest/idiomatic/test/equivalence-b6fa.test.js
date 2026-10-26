// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for scaleByPhaseFraction (ROM 0xb6fa-0xb71a) -- signed fractional scale of A by slot x's low 3
// phase bits ($02cc,x). RAM writes ($29/$2b/$2c) are scratch that end at fixed values, so the load-bearing
// live-out is the A return; the arms compare RAM (-stack) AND A. A leaf: it omits the ROM ret and the seam
// completes it. No POKEY/clock read, so the crafted seeds are deterministic.
// Run: node --test games/tempest/idiomatic/test/equivalence-b6fa.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_b6fa } from "../../translated/loc_b6fa.js";
import { scaleByPhaseFraction } from "../scaleByPhaseFraction.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { loc_29, loc_2b, COORD_LIST_PTR_LO, ENEMY_PHASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xb6fa;
const oracle = atEntry(loc_b6fa);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xb6fa dispatches -- scaleByPhaseFraction == oracle in RAM (-stack) and A", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); const r = scaleByPhaseFraction(c);
    assert.equal(ramDiff(o, c), null);
    assert.equal(c.regs.a, o.regs.a, "A live-out matches the oracle");
    assert.equal(r, o.regs.a, "return == A");
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: scaled A matches the oracle across values, x-slots and fractions", () => {
  const cases = [
    [0x00, 0, 0x00], [0x40, 0, 0x07], [0x80, 1, 0x05], [0xff, 2, 0x03],
    [0x7f, 3, 0x06], [0xc0, 5, 0x01], [0x33, 7, 0x04], [0x01, 4, 0x02],
  ];
  for (const [a, x, phase] of cases) {
    const o = new Machine(ROM, OPTS); o.regs.a = a; o.regs.x = x; o.mem.write8((ENEMY_PHASE + x) & 0xffff, phase);
    const c = new Machine(ROM, OPTS); c.regs.a = a; c.regs.x = x; c.mem.write8((ENEMY_PHASE + x) & 0xffff, phase);
    oracle(o); const r = scaleByPhaseFraction(c);
    assert.equal(ramDiff(o, c), null, `RAM equal: a=${a} x=${x} phase=${phase}`);
    assert.equal(c.regs.a, o.regs.a, `A matches oracle: a=${a} x=${x} phase=${phase}`);
    assert.equal(r, o.regs.a, `return == A: a=${a} x=${x} phase=${phase}`);
    assert.equal(c.mem.read8(loc_29), a, "$29 holds the input");
    assert.equal(c.mem.read8(loc_2b), x, "$2b holds x");
    assert.equal(c.mem.read8(COORD_LIST_PTR_LO), 0x00, "$2c fully consumed");
  }
});

test("TEETH: a twin that uses a logical (not arithmetic) shift diverges in A for a negative input", () => {
  const a = 0xf0, x = 0, phase = 0x07;
  const o = new Machine(ROM, OPTS); o.regs.a = a; o.regs.x = x; o.mem.write8((ENEMY_PHASE + x) & 0xffff, phase);
  oracle(o);
  // BUG: >>1 without sign extension
  let acc = 0, frac = phase & 0x07;
  for (let i = 0; i < 3; i++) { const b = frac & 1; frac >>= 1; if (b) acc = (acc + a) & 0xff; acc = (acc >> 1) & 0xff; }
  assert.notEqual(acc, o.regs.a, "the A check FAILED to catch the logical-shift twin");
});

test("SP-TOOTH: the omitted-ret leaf (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12); // a real caller-return word for the seam
  const r = seamPlaceable(withOmittedRet, scaleByPhaseFraction, TARGET, m);
  assert.equal(r.placeable, true, `scaleByPhaseFraction must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: omitted-ret leaf (moved 0) placeable");
});
