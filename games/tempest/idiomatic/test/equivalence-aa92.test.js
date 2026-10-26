// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for drawSlotThenDigitRun (ROM 0xaa92-0xaa96) -- loads X=2, draws via drawSlotShapeRecord, then tail-calls
// emitCountDigitRun. Dissolves both m.calls into direct idiomatic calls. All output is RAM (the draw setup + the
// vector words emitted downstream), so each arm compares the RAM diff (minus the dead stack). An
// omitted-ret tail-caller; A/X/Y at RTS are incidental.
// Run: node --test games/tempest/idiomatic/test/equivalence-aa92.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_aa92 } from "../../translated/loc_aa92.js";
import { drawSlotThenDigitRun } from "../drawSlotThenDigitRun.js";
import { drawSlotShapeRecord } from "../drawSlotShapeRecord.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xaa92;
const oracle = atEntry(loc_aa92);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 3000) : [];

// drawSlotThenDigitRun draws the fixed X=0x02 slot via drawSlotShapeRecord; the broken TEETH twin draws X=0x2c. Seed the ($ac)
// slot table so BOTH offsets point to a valid bit7-terminated vector list, and put the ($74) output
// cursor in writable vector RAM (0x2000-0x2fff) -- otherwise drawSlotShapeRecord's copy loop reads an unmapped cell.
function seat(m) {
  const tableBase = 0x0400;
  m.mem.write8(0xac, tableBase & 0xff); m.mem.write8(0xad, (tableBase >> 8) & 0xff);
  const seedList = (slot, listBase) => {
    m.mem.write8((tableBase + slot) & 0xffff, listBase & 0xff);
    m.mem.write8((tableBase + slot + 1) & 0xffff, (listBase >> 8) & 0xff);
    m.mem.write8((listBase + 0) & 0xffff, 0x06); // header
    m.mem.write8((listBase + 1) & 0xffff, 0x03); // entry
    m.mem.write8((listBase + 2) & 0xffff, 0x82); // bit7 terminator
  };
  seedList(0x02, 0x0500); // the fixed slot drawSlotThenDigitRun draws
  seedList(0x2c, 0x0520); // the wrong slot the TEETH twin draws
  m.mem.write8(0x74, 0x00); m.mem.write8(0x75, 0x28); // cursor -> 0x2800 vector RAM
}

test("CAPTURE: real 0xaa92 dispatches -- drawSlotThenDigitRun == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); drawSlotThenDigitRun(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: draw setup + tail == oracle (RAM)", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o); drawSlotThenDigitRun(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after draw + tail");
});

test("TEETH: a twin that skips the X=2 slot draw diverges from the oracle", () => {
  const o = new Machine(ROM, OPTS); seat(o); oracle(o);
  const c = new Machine(ROM, OPTS); seat(c);
  // BUG: draws with the wrong slot index (0x2c) instead of the fixed 0x02, and skips the aa97 tail.
  const broken = (m) => { drawSlotShapeRecord(m, 0x2c); };
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the wrong slot draw");
});

test("SP-TOOTH: the omitted-ret tail-caller is seam-placeable", () => {
  const m = new Machine(ROM, OPTS); seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, drawSlotThenDigitRun, TARGET, m);
  assert.equal(r.placeable, true, `drawSlotThenDigitRun must be seam-placeable; got: ${r.error}`);
});
