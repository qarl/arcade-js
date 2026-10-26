// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitProjectedSlotRecord (ROM 0xc423-0xc43b) -- copies four $03xx,x table cells (x=$37) into the
// $61..$64 record header, then tail-calls emitCoordDeltaRecord (which emits the record through emitCoordinateRecord). The oracle runs
// the translated emitCoordDeltaRecord via m.call; the idiomatic calls the idiomatic emitCoordDeltaRecord directly. Live-out is memory
// only (registers at RTS are incidental), so both sides run on a clone and the contract is RAM (-stack).
// Run: node --test games/tempest/idiomatic/test/equivalence-c423.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_c423 } from "../../translated/loc_c423.js";
import { emitProjectedSlotRecord } from "../emitProjectedSlotRecord.js";
import { Machine } from "../../machine.js";
import { firstStateDiff } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { SLOT_LOOP_INDEX, COL_VAL_A, COL_SUB_A, COL_VAL_B, COL_SUB_B, PROJ_Y_LO, PROJ_Y_HI, PROJ_X_LO, PROJ_X_HI, DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) {
  const u = new URL(name, ROM_DIR);
  return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined;
}
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xc423;
const oracle = atEntry(loc_c423);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 2000) : [];

test("CAPTURE: real 0xc423 dispatches -- emitProjectedSlotRecord == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitProjectedSlotRecord(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

function seed(m) {
  m.mem.write8(SLOT_LOOP_INDEX, 0x05);
  m.mem.write8((COL_SUB_A + 5) & 0xffff, 0x11);
  m.mem.write8((COL_VAL_A + 5) & 0xffff, 0x22);
  m.mem.write8((COL_SUB_B + 5) & 0xffff, 0x33);
  m.mem.write8((COL_VAL_B + 5) & 0xffff, 0x44);
  m.mem.write8(DRAW_CURSOR_LO, 0x30); m.mem.write8(DRAW_CURSOR_HI, 0x02); // record cursor into safe RAM
}

test("CRAFTED: the four indexed cells land in $61..$64 and RAM matches the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o); emitProjectedSlotRecord(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after copy + emit");
  assert.equal(c.mem.read8(PROJ_Y_LO), 0x11, "$61");
  assert.equal(c.mem.read8(PROJ_Y_HI), 0x22, "$62");
  assert.equal(c.mem.read8(PROJ_X_LO), 0x33, "$63");
  assert.equal(c.mem.read8(PROJ_X_HI), 0x44, "$64");
});

test("TEETH: a twin that skips the $63 copy diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seed(o);
  const c = new Machine(ROM, OPTS); seed(c);
  oracle(o);
  const broken = (m) => {
    const { mem8 } = m;
    const x = mem8[SLOT_LOOP_INDEX];
    mem8[PROJ_Y_LO] = mem8[(COL_SUB_A + x) & 0xffff];
    mem8[PROJ_Y_HI] = mem8[(COL_VAL_A + x) & 0xffff];
    // BUG: never copies into $63
    mem8[PROJ_X_HI] = mem8[(COL_VAL_B + x) & 0xffff];
  };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the skipped copy");
});
