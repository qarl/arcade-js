// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceFirstGroupEnemyActorStates (ROM 0x7625, Pooyan) — a twin entry to the shared
 * animation-tick walk: it seeds the record count (8) and runs the walk over the enemy-actor array
 * (base 0x8ae0, stride 0x18).
 *
 * SEATING: BALANCED (WIRE). The oracle tail-delegates into the shared walk, which ends in a plain
 * `ret`; advanceFirstGroupEnemyActorStates has no `pop af` of its own. The module does no stack ops; the oracle's pushes/pops
 * land in STACK_SCRATCH and drop from the diff.
 *
 * LIVE-OUT: none — a void delegator. The next thing its caller runs re-initialises its registers, so
 * nothing the walk leaves behind is read back. Fidelity = RAM (dumpState) minus stack scratch below the entry SP.
 *
 * The per-record probe is the +0x0e frame-hold byte (a ticked live record decrements it). Records are
 * tick state 2 with the drawn-flag open, so each merely steps and continues; a plain boot does not
 * seat this, so the state is CRAFTED.
 *
 * Jobs:
 *   1. EQUAL — a full walk with one extra armed record beyond the count: oracle == module in RAM.
 *   2. WRITE-SET — records 0..7 stepped, record 8 untouched (the seeded count is exactly 8).
 *   3. TEETH — a twin seeding the wrong count (7 under / 9 over) diverges from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7625.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7625 as oracle } from "../../translated/loc_7625.js";
import { advanceFirstGroupEnemyActorStates } from "../advanceFirstGroupEnemyActorStates.js";
import { advanceEnemyActorStateWalk } from "../advanceEnemyActorStateWalk.js"; // for the wrong-count teeth twins
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE, OBJECT_DRAWN_FLAG } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE; // 0x8ae0
const STRIDE = 0x18;
const STATE_FIELD = 0x02;
const HOLD_FIELD = 0x0e;
const HOLD_SEED = 0x05;
const STATE_STEP = 0x02;
const SEEDED_COUNT = 8; // the count advanceFirstGroupEnemyActorStates seeds
const SP0 = 0x8ff8;
const CALLER_RET = 0xabcd;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const recAddr = (idx) => REC + idx * STRIDE;

/** Arm records 0..8 as steppable state-2 records; the seeded walk of 8 should leave record 8 alone. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(CALLER_RET); // the delegated walk's ret consumes it (dead-stack)
  m.mem.write8(OBJECT_DRAWN_FLAG, 0x00);
  for (let i = 0; i <= SEEDED_COUNT; i++) {
    m.mem.write8(recAddr(i) + STATE_FIELD, STATE_STEP);
    m.mem.write8(recAddr(i) + HOLD_FIELD, HOLD_SEED);
  }
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: seeds count 8 and walks — module == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  advanceFirstGroupEnemyActorStates(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: RAM identical");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: exactly records 0..7 stepped, record 8 untouched (seeded count is 8)", () => {
  const o = craft();
  oracle(o);
  for (let i = 0; i < SEEDED_COUNT; i++) {
    assert.equal(o.mem.read8(recAddr(i) + HOLD_FIELD), HOLD_SEED - 1, `record ${i} hold decremented`);
  }
  assert.equal(o.mem.read8(recAddr(8) + HOLD_FIELD), HOLD_SEED, "record 8 untouched (count is 8, not 9)");
  console.log("  WRITE-SET: records 0..7 stepped, record 8 untouched");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin seeding the wrong count (7 under / 9 over) diverges from the oracle", () => {
  const under = craft();
  const underTwin = craft();
  oracle(under); // seeds 8
  advanceEnemyActorStateWalk(underTwin, 7); // BUG: under-seeded twin leaves record 7 un-stepped
  let d = ramDiffMinusStack(under, underTwin);
  assert.notEqual(d, null, "under-seed not caught");
  assert.equal(d.addr, recAddr(7) + HOLD_FIELD, `under-seed caught at ${hx(d.addr ?? 0)}`);

  const over = craft();
  const overTwin = craft();
  oracle(over); // seeds 8
  advanceEnemyActorStateWalk(overTwin, 9); // BUG: over-seeded twin steps record 8
  d = ramDiffMinusStack(over, overTwin);
  assert.notEqual(d, null, "over-seed not caught");
  assert.equal(d.addr, recAddr(8) + HOLD_FIELD, `over-seed caught at ${hx(d.addr ?? 0)}`);
  console.log("  TEETH/count: under-seed and over-seed both caught");
});
