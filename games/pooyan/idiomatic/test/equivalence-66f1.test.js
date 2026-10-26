// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchEnemyActorState (ROM 0x66f1) — the per-record state dispatcher.
 *
 * dispatchEnemyActorState selects one of four handlers by the record's state byte (ix+2), through the frozen
 * layer's rst-0x28 word table; the module replaces that with a switch calling the idiomatic
 * handlers. It is a pure tail dispatch — no continuation is stacked — and its caller (updateEnemyActorsAndCycleLaunchFlipAnim)
 * reads no register or return value back (it restores its own loop registers with exx), so the
 * contract is:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared, and there is no register/return live-out (both sides return
 * undefined). The record is based at ENEMY_ACTOR_TABLE (0x8ae0); the craft seats the fields that
 * keep each handler on a cheap, non-throwing path — (ix+0x0e) non-zero so the animation sequencer
 * advanceObjectAnimationFrame just decrements; (ix+7)/(ix+8)=0 so the state-2 handler takes no linked-record branch;
 * (ix+6)=0x18 so the state-1 handler skips its free-slot scan; and the shared gate/countdown/
 * frame-delay cells seeded so states 0 and 2/3 take their short countdown paths. Both sides run on
 * identical clones, so any deterministic handler effect matches; the test verifies the SELECTION.
 *
 * Jobs:
 *   1. EQUAL — over states 0..3, oracle == dispatchEnemyActorState in RAM (−stack), both returning undefined.
 *   2. WRITE-SET — state 0's short path decrements exactly SHARED_PHASE_COUNTDOWN.
 *   3. CRAFTED — all four states are craft-only (a plain boot dispatches this leaf zero times).
 *   4. TEETH — a wrong written byte MUST be caught by the RAM diff; a MIS-DISPATCH (running the
 *      wrong handler on the same craft) MUST diverge from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-66f1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_66f1 as oracle } from "../../translated/loc_66f1.js";
import { dispatchEnemyActorState } from "../dispatchEnemyActorState.js";
import { ascendEnemyActorAndLinkedSlotOnTimer } from "../ascendEnemyActorAndLinkedSlotOnTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  SHARED_PHASE_GATE,
  SHARED_PHASE_COUNTDOWN,
  SHARED_FRAME_DELAY_TIMER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = ENEMY_ACTOR_TABLE; // 0x8ae0 record base
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with (ix+2)=state and the fields that keep each handler on a cheap, safe path. */
function craft(state) {
  const m = BASE.clone();
  m.regs.sp = 0x8fe0; // inside STACK_SCRATCH: dispatch push + handler ret only touch dead stack
  m.regs.ix = IX;
  m.mem.write8(IX + 0x02, state & 0xff);
  m.mem.write8(IX + 0x05, 0x00);
  m.mem.write8(IX + 0x06, 0x18); // state-1 handler skips its free-slot scan
  m.mem.write8(IX + 0x07, 0x00); // state-2 handler: no linked record
  m.mem.write8(IX + 0x08, 0x00);
  m.mem.write8(IX + 0x09, 0x00);
  m.mem.write8(IX + 0x0e, 0x05); // advanceObjectAnimationFrame frame-hold: non-zero -> cheap decrement path
  m.mem.write8(SHARED_PHASE_GATE, 0x01); // state 0: gate open, then the countdown decrements
  m.mem.write8(SHARED_PHASE_COUNTDOWN, 0x05);
  m.mem.write8(SHARED_FRAME_DELAY_TIMER, 0x05); // states 2/3: short frame-delay path
  return m;
}

const STATES = [0, 1, 2, 3];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: states 0..3 — dispatchEnemyActorState == oracle in RAM (−stack), both return undefined", () => {
  for (const state of STATES) {
    const o = craft(state);
    const c = craft(state);
    const ro = oracle(o);
    const rc = dispatchEnemyActorState(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (state ${state})`);
    assert.equal(rc, ro, `return mismatch (state ${state})`);
    assert.equal(rc, undefined, `state ${state}: a tail dispatch returns undefined`);
  }
  console.log(`  EQUAL: ${STATES.length} states identical (RAM −stack), returns undefined`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: state 0's short path decrements exactly SHARED_PHASE_COUNTDOWN", () => {
  const before = craft(0);
  const after = craft(0);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) {
      const addr = after.stateOffsetToAddr(off);
      if (!inDeadStack(addr)) changed.push({ addr, to: a1[off] });
    }
  }
  assert.equal(changed.length, 1, `expected exactly 1 non-stack write, got ${changed.length}`);
  assert.equal(changed[0].addr, SHARED_PHASE_COUNTDOWN, `write must be at ${hx(SHARED_PHASE_COUNTDOWN)}`);
  assert.equal(changed[0].to, 0x04, "SHARED_PHASE_COUNTDOWN must decrement 5 -> 4");
  console.log(`  WRITE-SET: ${hx(SHARED_PHASE_COUNTDOWN)} 5 -> 4 (1 cell)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong written byte is CAUGHT by the RAM diff", () => {
  const o = craft(0);
  const c = craft(0);
  oracle(o);
  dispatchEnemyActorState(c);
  c.mem.write8(SHARED_PHASE_COUNTDOWN, 0x00); // BUG: state 0 leaves it at 4

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong countdown byte — it is worthless");
  assert.equal(d.addr, SHARED_PHASE_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a MIS-DISPATCH (state-2 handler on a state-0 record) diverges from the oracle", () => {
  const o = craft(0);
  const wrong = craft(0);
  oracle(o); // real dispatch -> state-0 handler (decrements SHARED_PHASE_COUNTDOWN)
  ascendEnemyActorAndLinkedSlotOnTimer(wrong); // WRONG: state-2 handler (decrements SHARED_FRAME_DELAY_TIMER instead)

  const d = ramDiffMinusStack(o, wrong);
  assert.notEqual(d, null, "a mis-dispatch produced identical RAM — the selection is untested");
  console.log(`  TEETH/DISPATCH: wrong handler diverged (RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} wrong=${d.b})`);
});
