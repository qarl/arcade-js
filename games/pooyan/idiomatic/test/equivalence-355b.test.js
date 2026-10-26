// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceActorTowardTargetColumn (Pooyan) — actor movement / target-seek AI step for the
 * record at IX: step the animation, advance X, resolve a target column, and either bail near, hand
 * to the pre-spawn guard, or latch + point at an approach animation.
 *
 * advanceActorTowardTargetColumn is reached by register dispatch (IX = the record). Its one register live-out is A on
 * the near bail (the actor column), written as a return-assignment for the frozen bridge; a tail
 * exit forwards its handler's own registers. So the register arm compares A on the near-bail arm;
 * equivalence otherwise is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * Crafted arms (record at REC, not latched, stage >= 3):
 *   - near-bail: extra-lane set + the skip-lookup flag clear -> range gate with a near column.
 *   - latch:     same, but a far column -> latch + setActorAnimation.
 *   - primary:   extra-lane clear -> the round-keyed table lookup path.
 *
 * Jobs:
 *   1. EQUAL — all three arms: oracle == advanceActorTowardTargetColumn in RAM (−stack).
 *   2. REGISTER — near-bail A live-out (actor column) matches the oracle.
 *   3. WRITE-SET — the range gate gates the latch: far column latches, near column does not.
 *   4. TEETH — a wrong advanced-X byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-355b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_355b as oracle } from "../../translated/loc_355b.js";
import { advanceActorTowardTargetColumn } from "../advanceActorTowardTargetColumn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8a80; //           actor record base (also ACTOR_TABLE)
const REC_X = REC + 0x05;
const REC_COLUMN = REC + 0x06;
const REC_FLAGS = REC + 0x07;
const REC_LATCH = REC + 0x08;
const REC_STEP = REC + 0x09;
const REC_ANIM_HOLD = REC + 0x0e;
const STAGE_COUNTDOWN = 0x8901;
const ACTIVE_LANE_COUNT = 0x8d79;
const SP0 = 0x8ff0; //           inside STACK_SCRATCH
const NEAR_COL = 0x0a; //        below the 0x14 range limit -> near bail
const FAR_COL = 0x20; //         at/above 0x14 -> latch path

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the record seated for one seek arm. */
function craft({ col = NEAR_COL, activeLane = 0x01, flags = 0x00 } = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[REC_X] = 0x10; // X, advanced by the step below
  m.mem8[REC_COLUMN] = col & 0xff;
  m.mem8[REC_FLAGS] = flags & 0xff;
  m.mem8[REC_LATCH] = 0x00; // not latched -> the seek runs
  m.mem8[REC_STEP] = 0x01; // +1, no carry
  m.mem8[REC_ANIM_HOLD] = 0x05; // holding -> the anim step just ticks, leaves the column alone
  m.mem8[STAGE_COUNTDOWN] = 0x05; // >= 3 -> the seek is not skipped
  m.mem8[ACTIVE_LANE_COUNT] = activeLane & 0xff;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: near-bail + latch + primary arms — advanceActorTowardTargetColumn == oracle in RAM (−stack)", () => {
  const arms = [
    ["near-bail", { col: NEAR_COL, activeLane: 0x01 }],
    ["latch", { col: FAR_COL, activeLane: 0x01 }],
    ["primary lookup", { col: NEAR_COL, activeLane: 0x00 }],
  ];
  for (const [label, opts] of arms) {
    const o = craft(opts);
    oracle(o);
    const c = craft(opts);
    advanceActorTowardTargetColumn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: near-bail + latch + primary identical (RAM −stack)");
});

// -- 2. REGISTER (A live-out on the near bail) --------------------------------

test("REGISTER: near-bail A live-out (actor column) matches the oracle", () => {
  const o = craft({ col: NEAR_COL, activeLane: 0x01 });
  oracle(o);
  const c = craft({ col: NEAR_COL, activeLane: 0x01 });
  advanceActorTowardTargetColumn(c);
  assert.equal(o.regs.a, NEAR_COL, "oracle near-bail leaves A = the actor column");
  assert.equal(c.regs.a, o.regs.a, `A live-out mismatch: oracle=${hx(o.regs.a)} module=${hx(c.regs.a)}`);
  console.log(`  REGISTER: near-bail A live-out ${hx(c.regs.a)} matches`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the range gate gates the latch", () => {
  const far = craft({ col: FAR_COL, activeLane: 0x01 });
  oracle(far);
  assert.equal(far.mem8[REC_LATCH], 0x01, "far column -> latched");

  const near = craft({ col: NEAR_COL, activeLane: 0x01 });
  oracle(near);
  assert.equal(near.mem8[REC_LATCH], 0x00, "near column -> not latched");

  assert.notEqual(far.mem8[REC_LATCH], near.mem8[REC_LATCH], "the range gate must gate the latch");
  console.log("  WRITE-SET: far column latches, near column does not");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong advanced-X byte is CAUGHT by the RAM diff", () => {
  const o = craft({ col: NEAR_COL, activeLane: 0x01 });
  const c = craft({ col: NEAR_COL, activeLane: 0x01 });
  oracle(o);
  advanceActorTowardTargetColumn(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: near-bail arm must match before the poke");
  c.mem8[REC_X] = 0x10; // BUG: the step must have advanced X to 0x11
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong advanced-X byte — it is worthless");
  assert.equal(d.addr, REC_X, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong advanced-X caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
