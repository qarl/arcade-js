// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitCoordDeltaRecord (ROM 0xc3ba-0xc3ed) -- stores two 16-bit differences (cur-prev) into
// $6e/$6f and $70/$71, emits the record through emitCoordinateRecord (X=$6e), then latches cur ($61-$64) into prev
// ($6a-$6d) and sets $73=0xc0. The idiomatic side dissolves the jsr $df92 into a direct call. Live-out is
// memory only, so each arm compares RAM (dumpState minus stack scratch below the entry SP).
// Run: node --test games/tempest/idiomatic/test/equivalence-c3ba.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c3ba } from "../../translated/loc_c3ba.js";
import { emitCoordDeltaRecord } from "../emitCoordDeltaRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { emitCoordinateRecord } from "../emitCoordinateRecord.js";
import { PROJ_Y_LO, PROJ_Y_HI, PROJ_X_LO, PROJ_X_HI, PREV_Y_LO, PREV_Y_HI, PREV_X_LO, PREV_X_HI,
         VEC_DELTA_Y_LO, DRAW_DELTA_A_HI, DRAW_DELTA_B_LO, DRAW_DELTA_B_HI, VG_RECORD_HEADER, DRAW_CURSOR_LO } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc3ba;
const oracle = atEntry(loc_c3ba);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

test("CAPTURE: real 0xc3ba dispatches -- emitCoordDeltaRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitCoordDeltaRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

// Distinct cur/prev so both 16-bit subtracts are non-trivial (second pair borrows). Cursor aimed into
// vector RAM so emitCoordinateRecord's emit lands in the diffed region. Delta slots dirtied to prove they are rewritten.
function seed(m) {
  m.mem.write8(PROJ_Y_LO, 0x50); m.mem.write8(PROJ_Y_HI, 0x01); // cur pair A
  m.mem.write8(PREV_Y_LO, 0x10); m.mem.write8(PREV_Y_HI, 0x00); // prev pair A -> delta 0x0140
  m.mem.write8(PROJ_X_LO, 0x30); m.mem.write8(PROJ_X_HI, 0x02); // cur pair B
  m.mem.write8(PREV_X_LO, 0x40); m.mem.write8(PREV_X_HI, 0x00); // prev pair B -> delta borrows
  for (const a of [VEC_DELTA_Y_LO, DRAW_DELTA_A_HI, DRAW_DELTA_B_LO, DRAW_DELTA_B_HI]) m.mem.write8(a, 0x99); // dirty sentinels
  m.mem.write8(VG_RECORD_HEADER, 0x07); // key byte for the fold
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_LO + 1, 0x21); // ($74) -> 0x2100
}

test("CRAFTED: two 16-bit subtracts + emit + latch -- RAM equal", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitCoordDeltaRecord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after subtract/emit/latch");
  assert.equal(c.mem.read8(VEC_DELTA_Y_LO), 0x40, "delta A low");
  assert.equal(c.mem.read8(DRAW_DELTA_A_HI), 0x01, "delta A high");
  assert.equal(c.mem.read8(PREV_Y_LO), 0x50, "prev A low latched from cur");
  assert.equal(c.mem.read8(VG_RECORD_HEADER), 0xc0, "$73 flagged ready");
});

test("TEETH: a twin that skips the emit + latch diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o); oracle(o);
  const c = new Machine(ROM, OPTS); seed(c);
  const broken = (m) => {
    const { mem8 } = m;
    const d0 = mem8[PROJ_Y_LO] - mem8[PREV_Y_LO];
    mem8[VEC_DELTA_Y_LO] = d0;
    mem8[DRAW_DELTA_A_HI] = mem8[PROJ_Y_HI] - mem8[PREV_Y_HI] - (d0 < 0 ? 1 : 0);
    const d1 = mem8[PROJ_X_LO] - mem8[PREV_X_LO];
    mem8[DRAW_DELTA_B_LO] = d1;
    mem8[DRAW_DELTA_B_HI] = mem8[PROJ_X_HI] - mem8[PREV_X_HI] - (d1 < 0 ? 1 : 0);
    // BUG: never emits through emitCoordinateRecord, never latches cur, never flags $73
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped emit + latch");
});

test("SP-TOOTH: the omitted-ret caller (moved 0) is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_LO + 1, 0x21);
  const r = seamPlaceable(withOmittedRet, emitCoordDeltaRecord, TARGET, m);
  assert.equal(r.placeable, true, `emitCoordDeltaRecord must be seam-placeable; got: ${r.error}`);
});
