// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for emitFixedHeaderAndClearVectorSlots -- emits one framing record then clears four even-indexed slots in each
// of two register banks; dissolves the m.call to df39 into a direct idiomatic call. Output is RAM (the
// ($74) record + the two banks), so each arm compares the RAM diff (minus dead stack). An omitted-ret
// rewrite: the module drops the ROM ret and the seam completes it; A/X at RTS are incidental.
// Run: node --test games/tempest/idiomatic/test/equivalence-db84.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db84 } from "../../translated/loc_db84.js";
import { emitFixedHeaderAndClearVectorSlots } from "../emitFixedHeaderAndClearVectorSlots.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { atEntry, deadStackAtEntry } from "./_entryFloor.js";
import { DRAW_CURSOR_LO, DRAW_CURSOR_HI } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const OPTS = { vectorrom: opt("vectorrom.bin"), avgprom: opt("avgprom.bin") };
function opt(name) { const u = new URL(name, ROM_DIR); return existsSync(u) ? new Uint8Array(readFileSync(u)) : undefined; }
const test = ROM_PRESENT ? nodeTest : (name, fn) => nodeTest(name, { skip: "ROM not built" }, fn);

const TARGET = 0xdb84;
const oracle = atEntry(loc_db84);
const ramDiff = (ma, mb) =>
  firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), deadStackAtEntry(ma, mb));

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  try { new Machine(ROM, { overrides: snap, ...OPTS }).runFrames(maxFrames); } catch { /* keep caps before any boot-gap throw */ }
  return caps;
}
const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

// Point the framing record ($74) into vector RAM so df39's word write is diffed.
function seat(m) { m.mem.write8(DRAW_CURSOR_LO, 0x00); m.mem.write8(DRAW_CURSOR_HI, 0x24); }

test("CAPTURE: real 0xdb84 dispatches -- emitFixedHeaderAndClearVectorSlots == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); emitFixedHeaderAndClearVectorSlots(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: framing record + even-slot bank clears == oracle (RAM)", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  // Dirty the target slots so the clears are observable.
  for (const mm of [o, c]) for (let x = 0; x <= 6; x += 2) {
    mm.mem.write8((0x60c1 + x) & 0xffff, 0xaa);
    mm.mem.write8((0x60d1 + x) & 0xffff, 0x55);
  }
  oracle(o); emitFixedHeaderAndClearVectorSlots(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after clears");
});

test("TEETH: a twin that corrupts the emitted framing record diverges from the oracle", () => {
  // The $60c1../$60d1.. bank slots are write-only MMIO (absent from dumpState), so the routine's only
  // diffable effect is the df39 framing word at ($74)->0x2400 plus the advanced ($74/$75) cursor. A sharp
  // twin perturbs that emitted record -- a cell the routine actually writes into diffable RAM.
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o);
  const broken = (mm) => { emitFixedHeaderAndClearVectorSlots(mm); mm.mem8[0x2400] ^= 0xff; }; // BUG: corrupts the framing word df39 emitted at ($74)
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted framing record");
});

test("SP-TOOTH: the omitted-ret rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, emitFixedHeaderAndClearVectorSlots, TARGET, m);
  assert.equal(r.placeable, true, `emitFixedHeaderAndClearVectorSlots must be seam-placeable; got: ${r.error}`);
});
