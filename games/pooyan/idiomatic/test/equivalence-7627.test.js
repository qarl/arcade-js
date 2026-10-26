// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyActorStateWalk (ROM 0x7627, Pooyan) — the shared per-frame animation-tick
 * walk. It ticks `count` records of the enemy-actor array (base 0x8ae0, stride 0x18) in order via the
 * per-entry tick dispatcher; a tick may abort the whole walk, and the loop early-returns so the
 * remaining records go untouched.
 *
 * SEATING: BALANCED (WIRE). The oracle ends in a plain `ret`; its abort path unwinds through the
 * handler's own `pop af; ret` to the SAME caller with SP fully balanced (translated test:
 * "every call push balanced, ret popped the caller" / "advanceEnemyActorStateWalk added no ret"). So the caller-skip is
 * absorbed inside the tick sub-graph and never reaches advanceEnemyActorStateWalk's caller. The module does no stack
 * ops; the oracle's pushes/pops all land in STACK_SCRATCH and drop from the diff.
 *
 * LIVE-OUT: none in registers. Both downstream consumers re-initialise their registers at entry
 * (the sprite-list builder loads HL/IX/DE/B and reads A from memory; the eagle blitter loads HL and
 * reads A from memory), so IX/B/A/flags the walk leaves behind are all dead. Fidelity = RAM
 * (dumpState) minus stack scratch below the entry SP. `count` is the entry-register bridge (m.regs.b).
 *
 * The per-record probe is the +0x0e frame-hold byte: a ticked live record decrements it by one, so
 * exactly which records at which stride were ticked is observable. Continue-records use tick state 2
 * (steps and never aborts); the abort uses tick state 1 with the shared phase countdown at zero
 * (steps, then reseeds the wave and aborts). States are CRAFTED; a plain boot does not seat them.
 *
 * Jobs:
 *   1. EQUAL — a full 8-record walk, an early-abort walk, and a 14-record walk via the register
 *      bridge: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the full walk decremented every in-range record's hold and left the out-of-range
 *      record untouched (positive control on base/stride/count).
 *   3. TEETH — a twin that ignores the abort, one that under-walks, and one that over-walks each
 *      diverge from the oracle at the first record they get wrong.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7627.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7627 as oracle } from "../../translated/loc_7625.js";
import { advanceEnemyActorStateWalk } from "../advanceEnemyActorStateWalk.js";
import { dispatchEnemyActorAnimTickState } from "../dispatchEnemyActorAnimTickState.js"; // for the teeth twins
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE, OBJECT_DRAWN_FLAG, SHARED_PHASE_COUNTDOWN } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; // 0x8ae0 — the walk base
const STRIDE = 0x18;
const STATE_FIELD = 0x02; //  state byte the tick dispatcher reads (&3)
const HOLD_FIELD = 0x0e; //   frame-hold byte the animation step decrements
const HOLD_SEED = 0x05; //    a live record's hold before a tick
const STATE_STEP = 0x02; //   tick state 2: steps then continues
const STATE_EXPIRE = 0x01; // tick state 1: with countdown 0, steps then aborts
const SP0 = 0x8ff8; //        inside STACK_SCRATCH
const CALLER_RET = 0xabcd;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const recAddr = (idx) => REC + idx * STRIDE;

/** Seat a return address in dead-stack (the oracle's ret consumes it) and arm the count register. */
function seat(m, count) {
  m.regs.sp = SP0;
  m.push16(CALLER_RET);
  m.regs.b = count;
  m.mem.write8(OBJECT_DRAWN_FLAG, 0x00); // gate the state-2 handler open so it steps
  return m;
}

/** A continue-record: tick state 2, live hold -> steps (hold--), keeps the walk going. */
function armStep(m, idx) {
  m.mem.write8(recAddr(idx) + STATE_FIELD, STATE_STEP);
  m.mem.write8(recAddr(idx) + HOLD_FIELD, HOLD_SEED);
}

/** N step-records (0..n-1) plus one extra armed but out-of-walk-range record at index `extra`. */
function craftFull(count, extra) {
  const m = seat(BASE.clone(), count);
  for (let i = 0; i < count; i++) armStep(m, i);
  if (extra != null) armStep(m, extra); // armed but beyond the walk
  return m;
}

/** Step-records 0..k-1, an aborting state-1 record at k, step-records k+1..count-1. */
function craftAbort(count, k) {
  const m = seat(BASE.clone(), count);
  for (let i = 0; i < count; i++) armStep(m, i);
  m.mem.write8(recAddr(k) + STATE_FIELD, STATE_EXPIRE);
  m.mem.write8(SHARED_PHASE_COUNTDOWN, 0x00); // countdown expired -> record k aborts the walk
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: full 8-record walk — module == oracle in RAM (−stack)", () => {
  const o = craftFull(8, 8); // record 8 armed but out of range
  const c = craftFull(8, 8);
  oracle(o); // reads count from regs.b
  advanceEnemyActorStateWalk(c, 8);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL full-8: RAM identical");
});

test("EQUAL: early-abort walk (abort at record 3) — module == oracle in RAM (−stack)", () => {
  const o = craftAbort(8, 3);
  const c = craftAbort(8, 3);
  oracle(o);
  advanceEnemyActorStateWalk(c, 8);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL abort@3: RAM identical");
});

test("EQUAL: 14-record walk via the register bridge (count = m.regs.b) — module == oracle", () => {
  const o = craftFull(14, null);
  const c = craftFull(14, null);
  oracle(o);
  advanceEnemyActorStateWalk(c); // no count arg -> defaults to m.regs.b (14), exactly the wired-override path
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL bridge-14: RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full walk ticks exactly records 0..7 (base/stride/count positive control)", () => {
  const o = craftFull(8, 8);
  oracle(o);
  for (let i = 0; i < 8; i++) {
    assert.equal(o.mem.read8(recAddr(i) + HOLD_FIELD), HOLD_SEED - 1, `record ${i} hold decremented`);
  }
  assert.equal(o.mem.read8(recAddr(8) + HOLD_FIELD), HOLD_SEED, "record 8 (out of range) untouched");
  console.log("  WRITE-SET: records 0..7 stepped, record 8 untouched");
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG: walk `count` records but IGNORE the abort signal (keeps ticking). */
function walkNoAbort(m, count) {
  let ix = REC;
  for (let n = count; n > 0; n--) {
    dispatchEnemyActorAnimTickState(m, ix);
    ix = u16(ix + STRIDE);
  }
}

/** BUG: walk a wrong number of records (miscounts the loop). */
function walkCount(m, count) {
  let ix = REC;
  for (let n = count; n > 0; n--) {
    if (!dispatchEnemyActorAnimTickState(m, ix)) return;
    ix = u16(ix + STRIDE);
  }
}

test("TEETH: a twin ignoring the abort keeps ticking and diverges at the first skipped record", () => {
  const o = craftAbort(8, 3);
  const twin = craftAbort(8, 3);
  oracle(o); // aborts at record 3; records 4..7 untouched
  walkNoAbort(twin, 8); // keeps going after the abort
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "gate FAILED to catch an ignored abort — worthless");
  assert.equal(d.addr, recAddr(4) + HOLD_FIELD, `teeth caught the ignored abort at ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/no-abort: caught at ${hx(d.addr)}`);
});

test("TEETH: an under-walk (count 7) leaves record 7 un-ticked; an over-walk (count 9) ticks record 8", () => {
  const under = craftFull(8, 8);
  const underTwin = craftFull(8, 8);
  oracle(under); // count 8
  walkCount(underTwin, 7); // BUG: one short
  let d = ramDiffMinusStack(under, underTwin);
  assert.notEqual(d, null, "under-walk not caught");
  assert.equal(d.addr, recAddr(7) + HOLD_FIELD, `under-walk caught at ${hx(d.addr ?? 0)}`);

  const over = craftFull(8, 8);
  const overTwin = craftFull(8, 8);
  oracle(over); // count 8
  walkCount(overTwin, 9); // BUG: one long -> ticks record 8
  d = ramDiffMinusStack(over, overTwin);
  assert.notEqual(d, null, "over-walk not caught");
  assert.equal(d.addr, recAddr(8) + HOLD_FIELD, `over-walk caught at ${hx(d.addr ?? 0)}`);
  console.log("  TEETH/count: under-walk and over-walk both caught");
});
