// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for buildLargeDecimalNumber -- packed-decimal prologue (two input pairs, the first doubled, forced to
// a minimum of one) then five binary-to-BCD double-dabble passes over the three-byte source the running
// pointer walks, with dissolved runMathboxDivide / emitCoordinateVectorWord / emitNibbleDigitRun / emitScaledCoordinateRecord. Live-out is memory only; each arm
// runs on a clone and compares RAM (dumpState minus stack scratch below the entry SP). The double-dabble result is independent
// of the entry carry (its residue lands in overwritten scratch), so the arms may enter with either carry.
// Run: node --test games/tempest/idiomatic/test/equivalence-dd41.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_dd41 } from "../../translated/loc_dd41.js";
import { buildLargeDecimalNumber } from "../buildLargeDecimalNumber.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import {
  MATHBOX_LD_R7_LO, MATHBOX_LD_R7_HI, COORD_ACC_LO, COORD_ACC_HI, DIGIT_IN_LO, DIGIT_IN_HI,
  TIMER2_LO, TIMER2_MID, TIMER2_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdd41;
const oracle = atEntry(loc_dd41);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdd41 dispatches -- buildLargeDecimalNumber == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); buildLargeDecimalNumber(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m, s) {
  m.mem.write8(COORD_ACC_LO, s.c); m.mem.write8(COORD_ACC_HI, s.d);
  m.mem.write8(DIGIT_IN_LO, s.f); m.mem.write8(DIGIT_IN_HI, s.g);
  m.mem.write8(TIMER2_LO, 0x11); m.mem.write8(TIMER2_MID, s.a); m.mem.write8(TIMER2_HI, s.b);
  for (let i = 0; i < 20; i++) m.mem.write8((0x0400 + i) & 0xffff, (s.base + i) & 0xff); // ($3b) source run
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20);
}

test("CRAFTED: prologue sums and five BCD passes -- RAM equal (opposite entry carry)", () => {
  const s = { c: 0x34, d: 0x12, f: 0x00, g: 0x00, a: 0x10, b: 0x00, base: 0x10 };
  const o = new Machine(ROM, OPTS); seed(o, s); o.regs.fC = true;
  const c = new Machine(ROM, OPTS); seed(c, s); c.regs.fC = false;
  oracle(o); buildLargeDecimalNumber(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after conversion");
});

// $6095/$6096/$608d are write-only MMIO -- absent from dumpState and they THROW on read, so the min-clamp
// store cannot be observed via ramDiff or read8. Capture the write stream instead: it asserts MORE than the
// diff (the module must reproduce the oracle's exact MMIO write sequence, invisible to dumpState).
function recordWrites(m, addr) {
  const orig = m.mem.write8.bind(m.mem);
  const log = [];
  m.mem.write8 = (a, v) => { if ((a & 0xffff) === addr) log.push(v & 0xff); return orig(a, v); };
  return log;
}

test("CRAFTED (min-clamp): zero magnitude forces $6095 to 0x01 -- RAM equal", () => {
  const s = { c: 0x00, d: 0x00, f: 0x00, g: 0x00, a: 0x00, b: 0x00, base: 0x00 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  // seed()'s source-run fill ($0400+i) overwrites the prologue inputs ($40c/$40d/$40f/$410), so base alone
  // cannot zero the magnitude. Force those four cells to zero AFTER the fill so ($40c:$40d) + 2*($40f:$410)
  // is truly zero and the min-clamp path fires (both machines get the same input -> ramDiff stays valid).
  for (const mm of [o, c]) {
    mm.mem.write8(COORD_ACC_LO, 0x00); mm.mem.write8(COORD_ACC_HI, 0x00);
    mm.mem.write8(DIGIT_IN_LO, 0x00); mm.mem.write8(DIGIT_IN_HI, 0x00);
  }
  const o95 = recordWrites(o, MATHBOX_LD_R7_LO), o96 = recordWrites(o, MATHBOX_LD_R7_HI);
  const c95 = recordWrites(c, MATHBOX_LD_R7_LO), c96 = recordWrites(c, MATHBOX_LD_R7_HI);
  oracle(o); buildLargeDecimalNumber(c);
  assert.equal(ramDiff(o, c), null, "RAM equal");
  assert.deepEqual(c95, o95, "module reproduces the oracle's $6095 write stream");
  assert.deepEqual(c96, o96, "module reproduces the oracle's $6096 write stream");
  assert.equal(c95.at(-1), 0x01, "min clamp forces $6095 to 0x01");
  assert.equal(c96.at(-1), 0x00, "high byte zero");
});

test("TEETH: a twin that skips the conversion diverges from the oracle", () => {
  const s = { c: 0x99, d: 0x88, f: 0x77, g: 0x66, a: 0x55, b: 0x44, base: 0x77 };
  const o = new Machine(ROM, OPTS); seed(o, s);
  const c = new Machine(ROM, OPTS); seed(c, s);
  oracle(o);
  const broken = (m) => { buildLargeDecimalNumber; /* BUG: never writes $6095/$6096 or the BCD digits */ void m; };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped conversion");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const s = { c: 0x34, d: 0x12, f: 0x00, g: 0x00, a: 0x10, b: 0x00, base: 0x10 };
  const m = new Machine(ROM, OPTS); seed(m, s);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, buildLargeDecimalNumber, TARGET, m);
  assert.equal(r.placeable, true, `buildLargeDecimalNumber must be seam-placeable; got: ${r.error}`);
});
