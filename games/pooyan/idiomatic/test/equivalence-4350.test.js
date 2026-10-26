// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for countdownThenRearmTurnAnimationByFlag (ROM 0x4350) — object state handler. Steps the record's
 * animation sequencer (advanceObjectAnimationFrame), decrements the phase timer at rec+0x11 and returns until it
 * lapses, then decrements the state byte rec+0x02 and re-arms the turn animation: latchColumnLimitAndArmTurnAnimation
 * (limit 0xff, script 0x4203) when rec+0x08 bit0 is clear, else clearColumnLimitAndArmTurnAnimation (limit 0, script 0x4212).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — every callee is memory-only and the
 * per-frame dispatcher reads no result register, so there is no register live-out. pc/SP/cycles are
 * NOT compared.
 *
 * The record is based at IX; the leaf runs only during live object updates, so every case is
 * CRAFTED: the phase timer, the state byte, the variant flag, and the animation hold (rec+0x0e, set
 * non-zero so advanceObjectAnimationFrame just decrements it) are seated identically on both sides, with the record and
 * TURN_COLUMN_LIMIT pre-dirtied so each write is visible.
 *
 * Jobs:
 *   1. EQUAL — over the still-running exit and both arm variants oracle == countdownThenRearmTurnAnimationByFlag in RAM (−stack).
 *   2. WRITE-SET — the bit0-clear arm advances the state byte, arms TURN_COLUMN_LIMIT=0xff and points
 *      the record at script 0x4203 with frame index 0.
 *   3. TEETH — a twin that mis-steps the state byte MUST be caught by the RAM diff; a twin that arms
 *      the WRONG turn-column limit MUST be caught too.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4350.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4350 as oracle } from "../../translated/loc_4350.js";
import { countdownThenRearmTurnAnimationByFlag } from "../countdownThenRearmTurnAnimationByFlag.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, TURN_COLUMN_LIMIT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0;        // work-RAM record base (IX); disjoint from TURN_COLUMN_LIMIT (0x8d4b)
const REC_LEN = 0x18;
const HOLD = 0x0e;         // animation hold offset advanceObjectAnimationFrame decrements
const TIMER = 0x11;        // phase-timer offset
const STATE = 0x02;        // state-byte offset
const FLAG = 0x08;         // variant-flag offset (bit0)
const ANIM_LO = 0x0c, ANIM_HI = 0x0d;
const SCRIPT_4203 = 0x4203; // bit0-clear turn script
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record pre-dirtied to 0xAA, the four control fields seated, IX=REC. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0xaa);
  m.mem.write8(TURN_COLUMN_LIMIT, 0xaa);
  m.mem.write8(REC + HOLD, 0x03);  // non-zero: advanceObjectAnimationFrame just decrements this frame
  m.mem.write8(REC + TIMER, scn.timer);
  m.mem.write8(REC + STATE, scn.state);
  m.mem.write8(REC + FLAG, scn.flag);
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead-stack scratch
  return m;
}

const CASES = [
  { name: "timer-running", timer: 0x05, state: 0x09, flag: 0x00 },
  { name: "lapse/bit0-clear", timer: 0x01, state: 0x09, flag: 0x02 },
  { name: "lapse/bit0-set", timer: 0x01, state: 0x09, flag: 0x03 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: running + both arm variants — countdownThenRearmTurnAnimationByFlag == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    countdownThenRearmTurnAnimationByFlag(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the bit0-clear arm steps state, arms limit=0xff, points at script 0x4203", () => {
  const scn = CASES[1];
  const c = craft(scn);
  countdownThenRearmTurnAnimationByFlag(c);
  assert.equal(c.mem.read8(REC + TIMER), 0x00, "phase timer decremented to 0 (lapsed)");
  assert.equal(c.mem.read8(REC + STATE), (scn.state - 1) & 0xff, "state byte stepped down by 1");
  assert.equal(c.mem.read8(TURN_COLUMN_LIMIT), 0xff, "turn-column limit armed to 0xff");
  assert.equal(c.mem.read8(REC + ANIM_LO), SCRIPT_4203 & 0xff, "animation pointer low = script 0x4203");
  assert.equal(c.mem.read8(REC + ANIM_HI), (SCRIPT_4203 >> 8) & 0xff, "animation pointer high = script 0x4203");
  assert.equal(c.mem.read8(REC + HOLD), 0x00, "animation frame index reset to 0 by the arm");
  console.log(`  WRITE-SET: state ${hx(scn.state)}->${hx(scn.state - 1)}, limit=0xff, anim->${hx(SCRIPT_4203)}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a mis-stepped state byte is CAUGHT by the RAM diff", () => {
  const scn = CASES[1];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  countdownThenRearmTurnAnimationByFlag(c);
  c.mem.write8(REC + STATE, scn.state); // BUG: state not stepped down

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a mis-stepped state byte — it is worthless");
  assert.equal(d.addr, REC + STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + STATE)})`);
  console.log(`  TEETH/RAM: mis-stepped state caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong turn-column limit is CAUGHT by the RAM diff", () => {
  const scn = CASES[1]; // bit0-clear arm sets limit=0xff
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  countdownThenRearmTurnAnimationByFlag(c);
  c.mem.write8(TURN_COLUMN_LIMIT, 0x00); // BUG: bit0-clear arm must set 0xff, not 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong turn-column limit — it is worthless");
  assert.equal(d.addr, TURN_COLUMN_LIMIT, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong turn-column limit caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
