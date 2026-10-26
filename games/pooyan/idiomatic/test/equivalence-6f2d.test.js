// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchEnemyActorRecordState (ROM 0x6f2d) — per-record state handler for the enemy-actor
 * table, record based at IX. Routes on the state byte rec+0x02: state 2 tails into tickActorHoldThenBlankAndClearWaveLatches; any
 * state below 0x0b runs advanceObjectAnimationFrame and returns; states 0x0b / 0x0c dispatch into seedEnemyFromDescriptorAndEnterFlight / advanceInFlightEnemyAndLand
 * (the two-entry word table at 0x6f3e indexed by state-0x0b).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM (through its callees), so every case
 * uses a FRESH clone per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — every callee is
 * memory-only and the scan loop (which exx-parks its own loop registers around the call) reads no
 * result register back, so there is NO register live-out. pc/SP/cycles are NOT compared.
 *
 * The record is based at IX; every case is CRAFTED. rec+0x0e (the animation hold) is seated non-zero
 * so advanceObjectAnimationFrame merely decrements it, and the timer / mode / state fields are seated on both sides.
 * States at/above 0x0d are NOT tested: the ROM table has only two entries, so the dispatch of a
 * higher state reads past it — behaviour the shipped record type never exercises.
 *
 * Jobs:
 *   1. EQUAL — state 2 (tickActorHoldThenBlankAndClearWaveLatches), two below-0x0b states (advanceObjectAnimationFrame), and both dispatch arms
 *      (seedEnemyFromDescriptorAndEnterFlight / advanceInFlightEnemyAndLand) agree in RAM (−stack).
 *   2. WRITE-SET — a below-0x0b state writes exactly rec+0x0e (advanceObjectAnimationFrame's hold decrement).
 *   3. TEETH — a twin with a wrong byte on the state-2 path is CAUGHT; and the two dispatch arms
 *      (0x0b vs 0x0c) must produce DIFFERENT RAM, proving the routing actually branches.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6f2d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6f2d as oracle } from "../../translated/loc_6f2d.js";
import { dispatchEnemyActorRecordState } from "../dispatchEnemyActorRecordState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0;   // enemy-actor record base (IX) — the routine's own table base
const REC_LEN = 0x18;
const HOLD = 0x0e;    // animation hold offset advanceObjectAnimationFrame decrements
const TIMER = 0x11;   // frame-timer offset used by tickActorHoldThenBlankAndClearWaveLatches / seedEnemyFromDescriptorAndEnterFlight
const STATE = 0x02;   // state byte the routine dispatches on
const MODE = 0x01;    // advanceInFlightEnemyAndLand mode byte (bit0)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function ramEqual(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  for (let off = 0; off < a.length; off++) if (a[off] !== b[off]) return false;
  return true;
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record pre-dirtied to 0xAA, hold/timer/mode/state seated, IX=REC. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0xaa);
  m.mem.write8(REC + HOLD, 0x03);   // non-zero: advanceObjectAnimationFrame just decrements the hold
  m.mem.write8(REC + TIMER, 0x02);  // >1 so timer-gated callees return without deeper work
  m.mem.write8(REC + MODE, 0x00);   // advanceInFlightEnemyAndLand free-flight mode
  m.mem.write8(REC + STATE, scn.state);
  m.regs.ix = REC;
  m.regs.sp = 0x8ffe; // dead-stack scratch
  return m;
}

const CASES = [
  { name: "state 2 -> hold tick",     state: 0x02 },
  { name: "state 0 -> mover",         state: 0x00 },
  { name: "state 5 -> mover",         state: 0x05 },
  { name: "state 0x0b -> dispatch 0", state: 0x0b },
  { name: "state 0x0c -> dispatch 1", state: 0x0c },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: hold-tick, movers, and both dispatch arms — dispatchEnemyActorRecordState == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    dispatchEnemyActorRecordState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted routing cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a below-0x0b state writes exactly rec+0x0e (the advanceObjectAnimationFrame hold decrement)", () => {
  const c = craft(CASES[2]); // state 5
  const before = c.dumpState();
  dispatchEnemyActorRecordState(c);
  const after = c.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) changed.push(c.stateOffsetToAddr(off));
  }
  assert.deepEqual(changed, [REC + HOLD], `unexpected write footprint: ${changed.map(hx)}`);
  assert.equal(c.mem.read8(REC + HOLD), 0x02, "hold decremented 0x03 -> 0x02");
  console.log("  WRITE-SET: below-0x0b state writes rec+0x0e=0x02 (1 cell)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong byte on the state-2 path is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0]);
  const c = craft(CASES[0]);
  oracle(o);
  dispatchEnemyActorRecordState(c);
  c.mem.write8(REC + TIMER, 0x02); // BUG: tickActorHoldThenBlankAndClearWaveLatches decremented the timer to 1

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-decremented timer — it is worthless");
  assert.equal(d.addr, REC + TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: non-decremented timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: the two dispatch arms (0x0b vs 0x0c) produce DIFFERENT RAM (routing branches)", () => {
  const a = craft(CASES[3]); // -> seedEnemyFromDescriptorAndEnterFlight
  const b = craft(CASES[4]); // -> advanceInFlightEnemyAndLand
  dispatchEnemyActorRecordState(a);
  dispatchEnemyActorRecordState(b);
  assert.ok(!ramEqual(a, b), "dispatch arms 0x0b and 0x0c produced identical RAM — routing is untested");
  console.log("  TEETH/DISPATCH: state 0x0b and 0x0c drive distinct handlers (RAM differs)");
});
