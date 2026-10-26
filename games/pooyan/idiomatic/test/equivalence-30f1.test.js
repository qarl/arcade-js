// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for launchHunterFormationAndSeedSlots (ROM 0x30f1) — hunter-formation launch (dispatch state 0):
 * seed four formation-slot records (each pointed to by a 0x8920-table entry) from ROM param table
 * 0x3337 plus a 0x30 frame delay; prime the frame-timer block (0x8928:=0x0c); bump the formation
 * state (0x8f08); blank a 3x3 video block at 0x84c2; seat the formation script pointer (0x8f4b:=
 * 0x3370); emit a sound command (queueSoundCommand0E) and run the return-scan (scanDisplaySlotsAndTickBoardClear); then verify a ROM
 * self-check copy (0x3278) against its original (0x68ac) — a match returns, a mismatch wipes work RAM.
 *
 * The go-forward contract is RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared;
 * there is no register live-out (an rst-0x30 dispatch handler whose caller discards results). With
 * the intact ROM the self-check matches, so the clean ret path runs (no wipe).
 *
 * launchHunterFormationAndSeedSlots passes scanDisplaySlotsAndTickBoardClear a stale IX (0x8928, one past the four slots) and B=0, so the scan sweeps a
 * full 256 slots. The craft ZEROES that window (0x8928..0x8b27) so no slot carries the 0x8c tag and
 * tickHunterReturnCounterAndCheckBoardClear never fires, and points the four slot entries at scratch records ABOVE the window; with
 * BOARD_CLEAR_FLAG (0x89e5) zero the board-clear tail stays off. Everything here is CRAFTED (this
 * launch state is not reached in a plain attract).
 *
 * Jobs: 1. EQUAL over two slot-layouts. 2. WRITE-SET (the timer seed, script pointer, a record field,
 * the sound byte). 3. CRAFTED (pre-dirtied record fields overwritten). 4. TEETH — a wrong script
 * pointer and a wrong timer seed.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-30f1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_30f1 as oracle } from "../../translated/loc_30f1.js";
import { launchHunterFormationAndSeedSlots } from "../launchHunterFormationAndSeedSlots.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT_TABLE = 0x8920;
const SCAN_LO = 0x8928;
const SCAN_HI = 0x8b27; // last tag byte the 256-slot sweep can read
const FRAME_TIMER = 0x8928;
const FORMATION_STATE = 0x8f08;
const SCRIPT_PTR = 0x8f4b;
const SOUND_BYTE = 0x8d20;
const BOARD_CLEAR_FLAG = 0x89e5;
const PARAM_TABLE = 0x3337; // ROM: 4 bytes/slot
const SCRIPT_TABLE = 0x3370;
const REC_FIELDS = [0x04, 0x06, 0x09, 0x0f, 0x10];
const DIRTY = 0xaa;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function craft(recs) {
  const m = BASE.clone();
  for (let a = SCAN_LO; a <= SCAN_HI; a++) m.mem.write8(a, 0); // silence the 256-slot sweep
  for (let i = 0; i < 4; i++) {
    m.mem.write8(SLOT_TABLE + i * 2, recs[i] & 0xff);
    m.mem.write8(SLOT_TABLE + i * 2 + 1, recs[i] >> 8);
    for (const off of REC_FIELDS) m.mem.write8(recs[i] + off, DIRTY); // so a write always shows
  }
  m.mem.write8(BOARD_CLEAR_FLAG, 0);
  m.regs.sp = 0x8ffe;
  return m;
}

const LAYOUTS = [
  [0x8b30, 0x8b50, 0x8b70, 0x8b90],
  [0x8bb0, 0x8bd0, 0x8bf0, 0x8c10],
];

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL: crafted slot layouts — launchHunterFormationAndSeedSlots == oracle in RAM (−stack)", () => {
  for (const recs of LAYOUTS) {
    const o = craft(recs);
    const c = craft(recs);
    oracle(o);
    launchHunterFormationAndSeedSlots(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b} (recs @ ${hx(recs[0])})`);
  }
  console.log(`  EQUAL: ${LAYOUTS.length} crafted slot layouts identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the timer seed, script pointer, first record fields, and sound byte", () => {
  const recs = LAYOUTS[0];
  const m = craft(recs);
  oracle(m);
  assert.equal(m.mem.read8(FRAME_TIMER), 0x0c, "frame-timer block seeded");
  assert.equal(m.mem.read8(SCRIPT_PTR), SCRIPT_TABLE & 0xff, "script pointer low");
  assert.equal(m.mem.read8(SCRIPT_PTR + 1), SCRIPT_TABLE >> 8, "script pointer high");
  assert.equal(m.mem.read8(recs[0] + 0x09), 0x30, "record 0 frame delay");
  assert.equal(m.mem.read8(recs[0] + 0x04), ROM[PARAM_TABLE], "record 0 param byte 0");
  assert.equal(m.mem.read8(recs[0] + 0x10), ROM[PARAM_TABLE + 3], "record 0 param byte 3");
  assert.equal(m.mem.read8(SOUND_BYTE), 0x0e, "sound command byte latched (queueSoundCommand0E)");
  console.log("  WRITE-SET: 0x8928:=0x0c, 0x8f4b:=0x3370, record fields seeded, 0x8d20:=0x0e");
});

// -- 3. CRAFTED (overwrite) ---------------------------------------------------

test("CRAFTED: pre-dirtied record fields are overwritten identically", () => {
  const recs = LAYOUTS[1];
  const o = craft(recs);
  const c = craft(recs);
  oracle(o);
  launchHunterFormationAndSeedSlots(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  for (let s = 0; s < 4; s++) {
    assert.equal(c.mem.read8(recs[s] + 0x09), 0x30, `slot ${s} delay overwritten`);
    assert.equal(c.mem.read8(recs[s] + 0x04), ROM[PARAM_TABLE + s * 4], `slot ${s} anim byte`);
  }
  console.log("  CRAFTED: 0xAA record fields -> table/delay values on both sides");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong script pointer is CAUGHT by the RAM diff", () => {
  const recs = LAYOUTS[0];
  const o = craft(recs);
  const c = craft(recs);
  oracle(o);
  launchHunterFormationAndSeedSlots(c);
  c.mem.write8(SCRIPT_PTR, (SCRIPT_TABLE & 0xff) ^ 0xff); // BUG: wrong script pointer low byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong script pointer — it is worthless");
  assert.equal(d.addr, SCRIPT_PTR, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong script pointer caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong frame-timer seed is CAUGHT by the RAM diff", () => {
  const recs = LAYOUTS[0];
  const o = craft(recs);
  const c = craft(recs);
  oracle(o);
  launchHunterFormationAndSeedSlots(c);
  c.mem.write8(FRAME_TIMER, 0x00); // BUG: must be 0x0c
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer seed");
  assert.equal(d.addr, FRAME_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong timer seed caught at ${hx(d.addr)}`);
});
