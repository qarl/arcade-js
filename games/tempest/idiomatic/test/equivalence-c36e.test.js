// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawGatedRecordLoop (ROM 0xc36e-0xc3b9) -- when the gate byte (A) is zero, seats four indexed
// record fields ($61-$64) from the $031a/$032a/$033a/$034a,Y tables, emits the header via emitObjectPositionVector, caches
// its cursor to $b0/$b1, then draws one record per pass through emitProjectedSlotRecord, bumping the $37 index by 0x10 on
// each low-nibble saturation. The idiomatic side dissolves the two jsr into direct emitObjectPositionVector(m, 0x61) and
// emitProjectedSlotRecord(m) calls (c423 reads its index from $37 in RAM, so no register thread). Live-out is memory only,
// so each arm compares RAM (dumpState minus stack scratch below the entry SP); registers are NOT asserted.
// Run: node --test games/tempest/idiomatic/test/equivalence-c36e.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c36e } from "../../translated/loc_c36e.js";
import { drawGatedRecordLoop } from "../drawGatedRecordLoop.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { u16 } from "../../../../core/int.js";
import { emitObjectPositionVector } from "../emitObjectPositionVector.js";
import { emitProjectedSlotRecord } from "../emitProjectedSlotRecord.js";
import {
  SLOT_LOOP_INDEX, TABLE_CURSOR, PROJ_Y_LO, VG_RECORD_HEADER, DRAW_CURSOR_LO, DRAW_PATCH_PTR_LO, DRAW_PATCH_PTR_HI,
  TUBE_GEOM_FLAG, COL_VAL_A, COL_SUB_A, COL_VAL_B, COL_SUB_B,
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

const TARGET = 0xc36e;
const oracle = atEntry(loc_c36e);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xc36e dispatches -- drawGatedRecordLoop == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawGatedRecordLoop(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// A=0 so the body runs; distinct Y and source-table entries; $0111=0 -> full 0x0f count;
// ($74) cursor into vector RAM so the emitted records land in diffed RAM.
function seedRun(m) {
  m.regs.a = 0x00; m.regs.y = 0x03; m.regs.setNZ(m.regs.a);
  for (const b of [COL_VAL_A, COL_SUB_A, COL_VAL_B, COL_SUB_B]) {
    for (let i = 0; i < 8; i++) m.mem.write8(u16(b + i), (b + i) & 0xff);
  }
  m.mem.write8(TUBE_GEOM_FLAG, 0x00);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_LO + 1, 0x20); // ($74) -> 0x2000
}

test("CRAFTED: gate open (A=0) -- drawGatedRecordLoop == oracle in RAM, fields + cursor seated", () => {
  const o = new Machine(ROM, OPTS); seedRun(o);
  const c = new Machine(ROM, OPTS); seedRun(c);
  oracle(o); drawGatedRecordLoop(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after header + record draws");
  assert.equal(c.mem.read8(PROJ_Y_LO), c.mem.read8(u16(COL_SUB_A + 3)), "$61 = [$032a+Y]");
  assert.equal(c.mem.read8(VG_RECORD_HEADER), 0xc0, "$73 constant seated");
  assert.equal(c.mem.read8(TABLE_CURSOR), 0xff, "record loop ran the counter to 0xff");
});

test("CRAFTED: gate closed (A!=0) -- both skip, RAM unchanged and equal", () => {
  const o = new Machine(ROM, OPTS); seedRun(o); o.regs.a = 0x01; o.regs.setNZ(0x01);
  const c = new Machine(ROM, OPTS); seedRun(c); c.regs.a = 0x01; c.regs.setNZ(0x01);
  oracle(o); drawGatedRecordLoop(c);
  assert.equal(ramDiff(o, c), null, "RAM equal on the skip path");
  assert.equal(c.mem.read8(VG_RECORD_HEADER), o.mem.read8(VG_RECORD_HEADER), "no write on skip");
});

test("TEETH: a twin that runs the body regardless of the gate diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedRun(o); o.regs.a = 0x01; o.regs.setNZ(0x01); oracle(o); // gate closed -> oracle skips
  const c = new Machine(ROM, OPTS); seedRun(c); c.regs.a = 0x01; c.regs.setNZ(0x01);
  const brokenGate = (m, a = m.regs.a, y = m.regs.y) => {
    const mem8 = m.mem8;
    // BUG: ignores the gate and always draws the header
    mem8[SLOT_LOOP_INDEX] = y;
    mem8[PROJ_Y_LO] = mem8[u16(COL_SUB_A + y)];
    emitObjectPositionVector(m, 0x61);
  };
  brokenGate(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the ignored gate");
});

test("TEETH: a twin that skips the record loop diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seedRun(o); oracle(o);
  const c = new Machine(ROM, OPTS); seedRun(c);
  const brokenLoop = (m, a = m.regs.a, y = m.regs.y) => {
    const mem8 = m.mem8;
    if (a !== 0) return;
    mem8[SLOT_LOOP_INDEX] = y;
    mem8[PROJ_Y_LO] = mem8[u16(COL_SUB_A + y)];
    mem8[0x62] = mem8[u16(COL_VAL_A + y)];
    mem8[0x63] = mem8[u16(COL_SUB_B + y)];
    mem8[0x64] = mem8[u16(COL_VAL_B + y)];
    emitObjectPositionVector(m, 0x61);
    mem8[DRAW_PATCH_PTR_LO] = mem8[DRAW_CURSOR_LO];
    mem8[DRAW_PATCH_PTR_HI] = mem8[DRAW_CURSOR_LO + 1];
    // BUG: never runs the emitProjectedSlotRecord record loop
  };
  brokenLoop(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped record loop");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seedRun(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawGatedRecordLoop, TARGET, m);
  assert.equal(r.placeable, true, `drawGatedRecordLoop must be seam-placeable; got: ${r.error}`);
});
