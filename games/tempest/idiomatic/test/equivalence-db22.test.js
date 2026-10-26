// SPDX-License-Identifier: GPL-3.0-only
// Memory-equivalence for initVectorDisplayRegisters -- resets a bank of hardware registers, takes four settling reads,
// marches a single set bit across a 32-slot table, then emits one framing record; dissolves the tail
// m.call to df39 into a direct idiomatic call. Output is RAM (the $60xx bank + the ($74) record), so each
// arm compares the RAM diff (minus dead stack). A pure tail-caller (jmp df39): A at RTS is incidental.
// Run: node --test games/tempest/idiomatic/test/equivalence-db22.test.js

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_db22 } from "../../translated/loc_db22.js";
import { initVectorDisplayRegisters } from "../initVectorDisplayRegisters.js";
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

const TARGET = 0xdb22;
const oracle = atEntry(loc_db22);
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

test("CAPTURE: real 0xdb22 dispatches -- initVectorDisplayRegisters == oracle in RAM (-stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone(), c = cap.clone();
    oracle(o); initVectorDisplayRegisters(c);
    assert.equal(ramDiff(o, c), null);
  }
  console.log(`  CAPTURE: ${CAPS.length} dispatch(es) checked`);
});

test("CRAFTED: bank reset + bit march + framing == oracle (RAM)", () => {
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o); initVectorDisplayRegisters(c);
  assert.equal(ramDiff(o, c), null, "RAM equal after reset");
});

test("TEETH: a twin that corrupts the emitted framing record diverges from the oracle", () => {
  // The $6080..$609f marched slots are write-only MMIO (absent from dumpState), so the routine's only
  // diffable effect is the df39 framing word at ($74)->0x2400 plus the advanced ($74/$75) cursor. A sharp
  // twin perturbs that emitted record -- a cell the routine actually writes into diffable RAM.
  const o = new Machine(ROM, OPTS); seat(o);
  const c = new Machine(ROM, OPTS); seat(c);
  oracle(o);
  const broken = (mm) => { initVectorDisplayRegisters(mm); mm.mem8[0x2400] ^= 0xff; }; // BUG: corrupts the framing word df39 emitted at ($74)
  broken(c);
  assert.notEqual(ramDiff(o, c), null, "the RAM diff FAILED to catch the corrupted framing record");
});

test("SP-TOOTH: the omitted-ret tail rewrite is seam-placeable", () => {
  const m = new Machine(ROM, OPTS);
  seat(m);
  m.regs.s = 0xfb;
  m.mem.write8(0x01fc, 0x34); m.mem.write8(0x01fd, 0x12);
  const r = seamPlaceable(withOmittedRet, initVectorDisplayRegisters, TARGET, m);
  assert.equal(r.placeable, true, `initVectorDisplayRegisters must be seam-placeable; got: ${r.error}`);
});
