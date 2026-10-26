// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyAnimationPhase (ROM 0x3d5c, Pooyan) — object state-9 handler: step the
 * record's animation, count down the frame timer, and on expiry advance the animation phase (phase
 * 7 -> turn/select state; phase 4 -> swap animation + reseed timer), bump the phase-count and state,
 * and fall through into the state-10 handler.
 *
 * The module calls the idiomatic sub-routines directly; the oracle drives the same routines through
 * the frozen registry. advanceEnemyAnimationPhase is memory-only on every reachable exit (the fall-through always hits
 * blankEnemyBandOnTimerExpiry's not-elapsed path, since this routine already spent the timer), so the register file is
 * not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP (SP parked in dead stack so the
 * oracle's push/pop churn drops out). advanceObjectAnimationFrame is held on its frame-hold branch (rec+0x0e != 0) so
 * it never walks the ROM stream.
 *
 * Jobs:
 *   1. EQUAL — timer-running / phase-2 / phase-4 / phase-7 paths: oracle == advanceEnemyAnimationPhase in RAM (−stack).
 *   2. WRITE-SET — the timer gates the advance: running holds the state byte, expiry bumps it.
 *   3. TEETH — a wrong phase-count byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3d5c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3d5c as oracle } from "../../translated/loc_3d5c.js";
import { advanceEnemyAnimationPhase } from "../advanceEnemyAnimationPhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; //     actor-record base (IX)
const TIMER = REC + 0x11; //  frame timer
const PHASE = REC + 0x16; //  animation phase (read/tested)
const PCOUNT = REC + 0x13; // phase-count (written phase+1)
const STATE = REC + 0x02; //  object state byte
const HOLD = REC + 0x0e; //   advanceObjectAnimationFrame frame-hold (nonzero -> simple decrement branch)
const SP0 = 0x8fe0; //        inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone with the record seated: timer, phase, and a nonzero hold so advanceObjectAnimationFrame stays simple. */
function craft(timer, phase) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = SP0;
  m.mem8[TIMER] = timer & 0xff;
  m.mem8[PHASE] = phase & 0xff;
  m.mem8[HOLD] = 0x05; // advanceObjectAnimationFrame: frame still holding -> decrement, no ROM stream walk
  m.mem8[REC + 0x07] = 0x01; // armEnemyTurnAnimation select field (low 2 bits) on the phase-7 path
  m.mem8[STATE] = 0x03; // starting state
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: timer-running / phase 2 / phase 4 / phase 7 — advanceEnemyAnimationPhase == oracle in RAM (−stack)", () => {
  const cases = [
    { timer: 0x05, phase: 0x02, label: "timer running -> early return" },
    { timer: 0x01, phase: 0x02, label: "expiry, ordinary phase" },
    { timer: 0x01, phase: 0x04, label: "expiry, phase 4 -> swap anim + reseed" },
    { timer: 0x01, phase: 0x07, label: "expiry, phase 7 -> turn/select state" },
  ];
  for (const { timer, phase, label } of cases) {
    const o = craft(timer, phase);
    oracle(o);
    const c = craft(timer, phase);
    advanceEnemyAnimationPhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${cases.length} timer/phase paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the frame timer gates the state advance", () => {
  const running = craft(0x05, 0x02);
  oracle(running);
  assert.equal(running.mem8[STATE], 0x03, "timer running -> state byte held");

  const expiry = craft(0x01, 0x02);
  oracle(expiry);
  assert.equal(expiry.mem8[STATE], 0x04, "expiry -> state byte advanced");
  assert.equal(expiry.mem8[PCOUNT], 0x03, "expiry -> phase-count = phase + 1");

  assert.notEqual(running.mem8[STATE], expiry.mem8[STATE], "the timer must gate the advance");
  console.log("  WRITE-SET: timer running holds the state, expiry advances it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong phase-count byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01, 0x02);
  const c = craft(0x01, 0x02);
  oracle(o);
  advanceEnemyAnimationPhase(c);
  c.mem8[PCOUNT] = 0xff; // BUG: expiry must have written phase + 1 = 0x03
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong phase-count byte — it is worthless");
  assert.equal(d.addr, PCOUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong phase-count caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
