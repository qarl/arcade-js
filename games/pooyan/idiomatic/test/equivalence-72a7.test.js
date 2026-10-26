// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for driveEagleWavePerFrame (ROM 0x72a7) — the enemy-wave launch driver.
 *
 * driveEagleWavePerFrame has three states:
 *   - launch flag clear  -> seed the next wave (seedNextEagleWave), then return.
 *   - record count zero   -> tail hand-off to the inter-wave idle handler (tickEagleInterWaveHoldAndRearmLaunch).
 *   - otherwise           -> walk 2*(wave index) live records of the enemy-actor table (stride
 *                            0x18) through the per-record state handler (dispatchActiveEagleRecordState).
 * The frozen layer dissolved three marshalled calls (seed / idle / per-record); this module calls
 * the idiomatic routines directly. The contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared. The seed and record-walk branches return undefined on both sides.
 * The idle branch is a faithful tail hand-off: the module returns tickEagleInterWaveHoldAndRearmLaunch's value (its A live-out),
 * while the frozen oracle's `m.call` drops it (returns undefined) — so on that branch the RAW return
 * is not compared; instead we assert both sides leave the SAME register A, proving the hand-off
 * reached the idle handler and carried its live-out straight through.
 *
 * Jobs:
 *   1. EQUAL — each branch: oracle == driveEagleWavePerFrame in RAM (−stack); returns/A as described above.
 *   2. TEETH/RAM — a wrong written byte MUST be caught by the RAM diff.
 *   3. TEETH/BRANCH — running the WRONG branch's handler on a record-walk state MUST diverge.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-72a7.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_72a7 as oracle } from "../../translated/loc_72a7.js";
import { driveEagleWavePerFrame } from "../driveEagleWavePerFrame.js";
import { tickEagleInterWaveHoldAndRearmLaunch } from "../tickEagleInterWaveHoldAndRearmLaunch.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  WAVE_LAUNCH_FLAG,
  WAVE_RECORD_COUNT,
  WAVE_INDEX,
  WAVE_HOLD_TIMER,
  ENEMY_TARGET_REC0,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_STRIDE = 0x18;
const HOLD_SEED = 0x20; // non-zero hold -> the idle handler ticks it (its clean, deterministic path)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat an active state-1 (descend, no-carry) record whose handler writes deterministically. */
function seedDescendRecord(m, base) {
  m.mem.write8(base + 0x00, 0x01); // bit0 -> record active
  m.mem.write8(base + 0x01, 0x00);
  m.mem.write8(base + 0x02, 0x01); // state 1 -> descend handler
  m.mem.write8(base + 0x03, 0x10); // position low
  m.mem.write8(base + 0x04, 0x08); // position high (row)
  m.mem.write8(base + 0x09, 0x05); // per-record speed
  m.mem.write8(base + 0x0e, 0x04); // frame-hold non-zero -> anim stepper just decrements
}

/**
 * A fresh clone crafted onto one of the three branches:
 *   "seed"   -> launch flag clear, target slot clear (seedNextEagleWave seeds a real wave).
 *   "idle"   -> launched, no records, hold non-zero (tickEagleInterWaveHoldAndRearmLaunch ticks the hold).
 *   "walk"   -> launched, records present, wave index 1 -> two descend records walked.
 */
function craft(branch) {
  const m = BASE.clone();
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: every dispatch push/ret only touches dead stack
  if (branch === "seed") {
    m.mem.write8(WAVE_LAUNCH_FLAG, 0x00);
    m.mem.write8(ENEMY_TARGET_REC0, 0x00); // target slot clear -> the seed actually runs
    m.mem.write8(WAVE_INDEX, 0x00); // -> wave index 1, seeds two records (not the 4th-wave re-arm)
  } else if (branch === "idle") {
    m.mem.write8(WAVE_LAUNCH_FLAG, 0x01);
    m.mem.write8(WAVE_RECORD_COUNT, 0x00);
    m.mem.write8(WAVE_HOLD_TIMER, HOLD_SEED);
  } else {
    m.mem.write8(WAVE_LAUNCH_FLAG, 0x01);
    m.mem.write8(WAVE_RECORD_COUNT, 0x02); // non-zero -> enter the record walk
    m.mem.write8(WAVE_INDEX, 0x01); // loop count = 2*1 = 2 records
    m.mem.write8(WAVE_HOLD_TIMER, HOLD_SEED); // only read by the wrong-branch teeth below
    seedDescendRecord(m, ENEMY_ACTOR_TABLE);
    seedDescendRecord(m, ENEMY_ACTOR_TABLE + RECORD_STRIDE);
  }
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: seed / walk branches — driveEagleWavePerFrame == oracle in RAM (−stack), both return undefined", () => {
  for (const branch of ["seed", "walk"]) {
    const o = craft(branch);
    const c = craft(branch);
    const ro = oracle(o);
    const rc = driveEagleWavePerFrame(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (${branch})`);
    assert.equal(ro, undefined, `${branch}: oracle returns undefined`);
    assert.equal(rc, undefined, `${branch}: module returns undefined`);
  }
  console.log("  EQUAL: seed + walk identical (RAM −stack), both return undefined");
});

test("EQUAL: idle branch — RAM (−stack) identical AND the tail hand-off carries A through", () => {
  const o = craft("idle");
  const c = craft("idle");
  oracle(o);
  driveEagleWavePerFrame(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (idle)`);
  // The idle handler's live-out is register A; the tail hand-off must leave it identical on both sides.
  assert.equal(c.regs.a, o.regs.a, "idle: the tail hand-off must carry the idle handler's A live-out");
  assert.equal(c.regs.a, HOLD_SEED, "idle: A is the pre-decrement hold value");
  console.log(`  EQUAL: idle identical (RAM −stack); tail hand-off carried A=${hx(o.regs.a)}`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH/RAM: a wrong written byte is CAUGHT by the RAM diff", () => {
  const o = craft("idle");
  const c = craft("idle");
  oracle(o); // ticks the hold timer 0x20 -> 0x1f
  driveEagleWavePerFrame(c);
  c.mem.write8(WAVE_HOLD_TIMER, 0x00); // BUG: the idle tick leaves it at 0x1f

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong hold byte — it is worthless");
  assert.equal(d.addr, WAVE_HOLD_TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH/BRANCH: the idle handler on a record-walk state diverges from the oracle", () => {
  const o = craft("walk");
  const wrong = craft("walk");
  oracle(o); // real dispatch -> the record walk (modifies the two descend records)
  tickEagleInterWaveHoldAndRearmLaunch(wrong); // WRONG branch: the idle handler ticks the hold and ignores the records

  const d = ramDiffMinusStack(o, wrong);
  assert.notEqual(d, null, "a wrong branch produced identical RAM — the selection is untested");
  console.log(`  TEETH/BRANCH: wrong branch diverged (RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} wrong=${d.b})`);
});
