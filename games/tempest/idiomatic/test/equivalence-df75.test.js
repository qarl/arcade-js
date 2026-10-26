// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitScaledCoordinateRecord (ROM 0xdf75-0xdf91) -- widens A and X to little-endian /4-scaled,
// sign-extended pairs at $6e/$6f and $70/$71, then falls into emitCoordinateRecord with X=0x6e to emit the record.
// The idiomatic side dissolves the fall-through m.call($df92) into a direct emitCoordinateRecord(m, 0x6e) call.
// Live-out is memory only (the pairs plus everything emitCoordinateRecord's chain writes through the cursor; X is
// consumed as df92's index, not read externally), so each arm compares RAM (dumpState minus
// stack scratch below the entry SP). Run: node --test games/tempest/idiomatic/test/equivalence-df75.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_df75 } from "../../translated/loc_df75.js";
import { emitScaledCoordinateRecord } from "../emitScaledCoordinateRecord.js";
import { emitCoordinateRecord } from "../emitCoordinateRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { VEC_DELTA_Y_LO, DRAW_DELTA_A_HI, DRAW_DELTA_B_LO, DRAW_DELTA_B_HI, VG_RECORD_HEADER, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdf75;
const oracle = atEntry(loc_df75);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xdf75 dispatches -- emitScaledCoordinateRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitScaledCoordinateRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Seed the cursor into vector RAM (0x2000, diffed) plus a key byte, and dirty the four pair slots so a
// skipped scale shows. A=0x37 stays positive (hi=0x00); X=0xa5 is negative (hi=0xfe) -> exercises both
// the sign-extend path and the /4 low byte (0xa5<<2 = 0x94).
function seedRecord(m) {
  m.regs.a = 0x37;
  m.regs.x = 0xa5;
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x20); // ($74) -> 0x2000
  m.mem.write8(VG_RECORD_HEADER, 0x04); // key folded through df92's last byte
  for (const c of [VEC_DELTA_Y_LO, DRAW_DELTA_A_HI, DRAW_DELTA_B_LO, DRAW_DELTA_B_HI]) m.mem.write8(c, 0xee); // dirty sentinels
}

test("CRAFTED: pairs widened at $6e/$6f, $70/$71 then record emitted -- emitScaledCoordinateRecord == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedRecord(o);
  const c = new Machine(ROM, OPTS); seedRecord(c);
  oracle(o); emitScaledCoordinateRecord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after widen + emit");
  assert.equal(c.mem.read8(VEC_DELTA_Y_LO), 0xdc, "$6e = (0x37<<2)&0xff");
  assert.equal(c.mem.read8(DRAW_DELTA_A_HI), 0x00, "$6f = A sign-extended (positive)");
  assert.equal(c.mem.read8(DRAW_DELTA_B_LO), 0x94, "$70 = (0xa5<<2)&0xff");
  assert.equal(c.mem.read8(DRAW_DELTA_B_HI), 0xfe, "$71 = X sign-extended (negative)");
});

test("TEETH: a twin that skips the X pair (marshalling) diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedRecord(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedRecord(c);
  const brokenDf75 = (m, a = m.regs.a) => {
    const { mem8 } = m;
    // BUG: only widens A; leaves $70/$71 dirty, then emits the record anyway
    mem8[VEC_DELTA_Y_LO] = (a << 2) & 0xff;
    mem8[DRAW_DELTA_A_HI] = (a & 0x80 ? 0xff : 0x00) & 0xff;
    return emitCoordinateRecord(m, 0x6e);
  };
  brokenDf75(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped X pair");
});

// Non-default seed: both operands negative and both /4 low bytes non-trivial, cursor elsewhere in
// vector RAM -- a mutation that mis-scales must still diverge here.
function seedMut(m) {
  m.regs.a = 0xc3;
  m.regs.x = 0x9b;
  m.mem.write8(DRAW_CURSOR_LO, 0x40); m.mem.write8(DRAW_CURSOR_HI, 0x24); // ($74) -> 0x2440
  m.mem.write8(VG_RECORD_HEADER, 0x1a);
  for (const c of [VEC_DELTA_Y_LO, DRAW_DELTA_A_HI, DRAW_DELTA_B_LO, DRAW_DELTA_B_HI]) m.mem.write8(c, 0x11);
}

test("MUTATION: non-default seed -- emitScaledCoordinateRecord == oracle in RAM", () => {
  const o = new Machine(ROM, OPTS); seedMut(o);
  const c = new Machine(ROM, OPTS); seedMut(c);
  oracle(o); emitScaledCoordinateRecord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the non-default seed");
});

test("MUTATION TEETH: a twin that shifts by one instead of two diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedMut(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedMut(c);
  const brokenScale = (m, a = m.regs.a, x = m.regs.x) => {
    const { mem8 } = m;
    // BUG: single shift (<<1) instead of the /4-scale (<<2)
    mem8[VEC_DELTA_Y_LO] = (a << 1) & 0xff; mem8[DRAW_DELTA_A_HI] = (a & 0x80 ? 0xff : 0x00) & 0xff;
    mem8[DRAW_DELTA_B_LO] = (x << 1) & 0xff; mem8[DRAW_DELTA_B_HI] = (x & 0x80 ? 0xff : 0x00) & 0xff;
    return emitCoordinateRecord(m, 0x6e);
  };
  brokenScale(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong shift amount");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitScaledCoordinateRecord, TARGET, m);
  assert.equal(r.placeable, true, `emitScaledCoordinateRecord must be seam-placeable; got: ${r.error}`);
});
