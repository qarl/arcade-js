// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for applyRoundDeltaAndRearmMatchedRecord (ROM 0x62e6, Pooyan) — the caller in a caller-skip
 * cluster: it tag-matches a record, applies a per-round position delta, re-arms the record,
 * and tail-jumps into retireParityTargetSlotAndQueueSound, whose `pop af; ret` skips a frame.
 *
 * This gate composes the REAL idiomatic skip: applyRoundDeltaAndRearmMatchedRecord (idiomatic) imports retireParityTargetSlotAndQueueSound
 * (idiomatic) and calls it directly, early-returning on its `false`; the oracle applyRoundDeltaAndRearmMatchedRecord
 * (translated) runs the translated retireParityTargetSlotAndQueueSound internally, whose pop-af aborts. The two must
 * land byte-identical in RAM (dumpState, minus stack scratch below the entry SP). The oracle's transient stack
 * (its `call` return words plus retireParityTargetSlotAndQueueSound's pop-af/ret unwind) lives in STACK_SCRATCH and is
 * excluded; the idiomatic side spends no stack. pc/SP/cycles/register-file are NOT compared.
 *
 * retireParityTargetSlotAndQueueSound takes ONLY the pop-af path, so it always returns false and the caller always
 * aborts — but that abort is applyRoundDeltaAndRearmMatchedRecord's own tail, so an early-return and a normal fall-off
 * are the same landing here. (The true one-frame skip lands ABOVE applyRoundDeltaAndRearmMatchedRecord, in whatever
 * called it; that is outside this cluster and irrelevant to RAM equivalence.) There is thus
 * no "skip not taken" state to seat; the two states we vary are the SCAN outcome (a match
 * found vs the counter draining) and the I-parity that selects the cleared target record.
 *
 * INPUTS: A (tag to match), IY (record base), C (record count), DE (record stride), I (target
 * selector), ROUND_COUNTER 0x8907 (delta-table index (round&7)>>1), and the records' tag
 * bytes at +0x14. Writes: the matched record's +0x0a (delta), +0x16 (bit 5), +0x0c/+0x0d/+0x0e
 * (animation pointer 0x634f), the cleared target record (0x8c90/0x8ca8), and the sound ring.
 *
 * Jobs:
 *   1. EQUAL — over match-early / match-mid / exhaustion / match-last, each with an I-parity
 *      and a distinct round (delta-table index 0..3), oracle == applyRoundDeltaAndRearmMatchedRecord in RAM (−stack).
 *   2. WRITE-SET — the matched record gets +0x0a += table delta, bit 5 of +0x16, the anim
 *      pointer 0x634f at +0x0c/+0x0d/+0x0e:=0, and the I-selected target record is zeroed.
 *   3. TEETH — a wrong re-armed byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-62e6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_62e6 as oracle } from "../../translated/loc_62e6.js";
import { applyRoundDeltaAndRearmMatchedRecord } from "../applyRoundDeltaAndRearmMatchedRecord.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  ENEMY_TARGET_REC0,
  ENEMY_TARGET_REC1,
  POSITION_DELTA_TABLE_6360,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC_BASE = 0x8ae0; // record array base (IY)
const STRIDE = 0x18;
const COUNT = 6;
const TAG = 0x07;
const NONMATCH = 0x99;
const SP_SEAT = 0x8fe0; // inside STACK_SCRATCH: oracle's call/pop-af words stay in the excluded window

const TAG_OFFSET = 0x14;
const DELTA_FIELD = 0x0a;
const FLAG_FIELD = 0x16;
const ANIM_LO = 0x0c;
const REARM_BIT = 0x20;
const DELTA_SEED = 0x10;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** The advanced record pointer at loop exit: the matched record, or base+count*stride on exhaustion. */
function foundRec(matchRec) {
  const idx = matchRec === null ? COUNT : matchRec;
  return REC_BASE + idx * STRIDE;
}

/** A fresh clone with the scan inputs, round, and the found record + target record seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = SP_SEAT;
  m.regs.a = spec.tag & 0xff;
  m.regs.iy = REC_BASE;
  m.regs.c = COUNT;
  m.regs.de = STRIDE;
  m.regs.i = spec.ireg & 0xff;
  m.mem8[ROUND_COUNTER] = spec.round & 0xff;

  for (let k = 0; k < COUNT; k++) {
    m.mem8[REC_BASE + k * STRIDE + TAG_OFFSET] = k === spec.matchRec ? (spec.tag & 0xff) : NONMATCH;
  }

  const rec = foundRec(spec.matchRec);
  m.mem8[rec + DELTA_FIELD] = DELTA_SEED;
  m.mem8[rec + FLAG_FIELD] = 0x00;
  m.mem8[rec + ANIM_LO + 0] = 0xee;
  m.mem8[rec + ANIM_LO + 1] = 0xee;
  m.mem8[rec + ANIM_LO + 2] = 0xee;

  const target = spec.ireg === 0 ? ENEMY_TARGET_REC0 : ENEMY_TARGET_REC1;
  for (let j = 0; j < STRIDE; j++) m.mem8[target + j] = 0xaa;
  return m;
}

const CASES = [
  { name: "match at record 0, I==0, round 0 (delta idx 0)", tag: TAG, matchRec: 0, ireg: 0x00, round: 0x00 },
  { name: "match at record 3, I!=0, round 2 (delta idx 1)", tag: TAG, matchRec: 3, ireg: 0x01, round: 0x02 },
  { name: "counter exhausted, I==0, round 5 (delta idx 2)", tag: TAG, matchRec: null, ireg: 0x00, round: 0x05 },
  { name: "match at record 5, I!=0, round 7 (delta idx 3)", tag: TAG, matchRec: 5, ireg: 0x01, round: 0x07 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: applyRoundDeltaAndRearmMatchedRecord (composing the real idiomatic skip) == oracle in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    const c = craft(spec);
    oracle(o);
    const ret = applyRoundDeltaAndRearmMatchedRecord(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, false, `[${spec.name}] must forward the paired-clear caller-skip boolean (false)`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack), real idiomatic skip composed`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: matched record re-armed (delta, bit5, anim ptr) + I-selected target cleared", () => {
  const spec = CASES[0]; // match at 0, I==0, round 0
  const rec = foundRec(spec.matchRec);
  const index = (spec.round & 0x07) >> 1;
  const delta = BASE.mem8[POSITION_DELTA_TABLE_6360 + index];

  const o = craft(spec);
  oracle(o);

  assert.equal(o.mem8[rec + DELTA_FIELD], (DELTA_SEED + delta) & 0xff, "delta field += table delta");
  assert.equal(o.mem8[rec + FLAG_FIELD] & REARM_BIT, REARM_BIT, "flag field bit 5 set");
  assert.equal(o.mem8[rec + ANIM_LO + 0], 0x4f, "anim pointer low := 0x4f");
  assert.equal(o.mem8[rec + ANIM_LO + 1], 0x63, "anim pointer high := 0x63");
  assert.equal(o.mem8[rec + ANIM_LO + 2], 0x00, "anim step index := 0");
  for (let j = 0; j < STRIDE; j++) {
    assert.equal(o.mem8[ENEMY_TARGET_REC0 + j], 0x00, `target record byte +${j} cleared`);
  }
  console.log(`  WRITE-SET: rec+0x0a += ${hx(delta)}, bit5 of rec+0x16, anim ptr 0x634f, target 0x8c90 zeroed`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong re-armed byte is CAUGHT by the RAM diff", () => {
  const spec = CASES[1]; // match at 3, I!=0
  const rec = foundRec(spec.matchRec);
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  applyRoundDeltaAndRearmMatchedRecord(c);
  c.mem8[rec + FLAG_FIELD] = c.mem8[rec + FLAG_FIELD] & ~REARM_BIT; // BUG: bit 5 must be set

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a missing re-arm bit — it is worthless");
  assert.equal(d.addr, rec + FLAG_FIELD, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: missing re-arm bit caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
