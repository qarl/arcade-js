// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for stepActiveTargetActorRecords (ROM 0x2157, Pooyan) — step the two target actor records. Each
 * of the two passes runs the per-object stepper on a record whose presence bit0 is set; the pass count
 * lives in a memory cell (so it survives the stepper). After both records it runs a tamper check on the
 * anim-script cursor: a match zeroes a follow-up cell and returns, a mismatch tail-jumps the
 * grab-record walk.
 *
 * SEATING: BALANCED — the match exit is a plain `ret`; the mismatch exit tail-`jp`s the grab-record
 * walk, forwarded as `return advanceActorAnimationsUnlessGrabbing(m)`. LIVE-OUT: none on the match path (the caller reads memory);
 * the mismatch path forwards the walk's own live-out, which no caller of stepActiveTargetActorRecords reads back — so the
 * register file is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP.
 *
 * Cases are CRAFTED: a plain boot does not seat these records or the cursor value.
 *
 * Jobs:
 *   1. EQUAL — match with no stepped record, match with both records stepped (the stepper tree), and
 *      the mismatch tail: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a match zeroes the follow-up cell; the loop leaves the pass counter at 1.
 *   3. TEETH — a wrong follow-up byte and a wrong pass-counter byte are both caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2157.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2157 as oracle } from "../../translated/loc_2157.js";
import { stepActiveTargetActorRecords } from "../stepActiveTargetActorRecords.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_TARGET_REC0, ANIM_SCRIPT_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IY0 = ENEMY_TARGET_REC0; // first target record (0x8c90)
const STRIDE = 0x18;
const COUNTER = 0x8f15; // TARGET_SCAN_COUNTER
const CURSOR = ANIM_SCRIPT_CURSOR; // 0x8f00
const FOLLOWUP = 0x8f02; // cell zeroed on a tamper match
const MATCH_CURSOR = 0xd5; // 0x0c + 0xc9 -> tamper match
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the two records' presence bits, the cursor, and a dirtied follow-up cell. */
function seat(m, { rec0 = 0x00, rec1 = 0x00, cursor = MATCH_CURSOR } = {}) {
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(IY0 + 0 * STRIDE, rec0);
  m.mem.write8(IY0 + 1 * STRIDE, rec1);
  m.mem.write8(CURSOR, cursor);
  m.mem.write8(FOLLOWUP, 0xee); // pre-dirty so a zeroing write is observable
  return m;
}

const craftMatchNoStep = () => seat(BASE.clone(), { cursor: MATCH_CURSOR });
const craftMatchStep = () => seat(BASE.clone(), { rec0: 0x01, rec1: 0x01, cursor: MATCH_CURSOR });
const craftMismatch = () => seat(BASE.clone(), { cursor: 0x00 });

const CASES = [
  { name: "match, no stepped record", craft: craftMatchNoStep },
  { name: "match, both records stepped", craft: craftMatchStep },
  { name: "mismatch -> grab-record walk", craft: craftMismatch },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: stepActiveTargetActorRecords == oracle in RAM (−stack) across the callee tree", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    stepActiveTargetActorRecords(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a match zeroes the follow-up cell; the loop leaves the pass counter at 1", () => {
  const match = craftMatchNoStep();
  oracle(match);
  assert.equal(match.mem.read8(FOLLOWUP), 0x00, "a tamper match zeroes the follow-up cell");
  assert.equal(match.mem.read8(COUNTER), 0x01, "the two-pass loop leaves the counter at 1");

  const mismatch = craftMismatch();
  oracle(mismatch);
  assert.notEqual(mismatch.mem.read8(FOLLOWUP), 0x00, "a mismatch does not zero the follow-up cell");
  console.log("  WRITE-SET: match zeroes; mismatch leaves it; counter drains to 1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong follow-up byte is CAUGHT by the RAM diff", () => {
  const o = craftMatchNoStep();
  const c = craftMatchNoStep();
  oracle(o);
  stepActiveTargetActorRecords(c);
  c.mem.write8(FOLLOWUP, (o.mem.read8(FOLLOWUP) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted follow-up byte");
  assert.equal(d.addr, FOLLOWUP, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong pass-counter byte is CAUGHT by the RAM diff", () => {
  const o = craftMatchNoStep();
  const c = craftMatchNoStep();
  oracle(o);
  stepActiveTargetActorRecords(c);
  c.mem.write8(COUNTER, (o.mem.read8(COUNTER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted pass-counter byte");
  assert.equal(d.addr, COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(counter): caught at ${hx(d.addr)}`);
});
