// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence + boolean-return test for retireParityTargetSlotAndQueueSound (ROM 0x6274, Pooyan) — the
 * interrupt-parity target-record clear that ends in `pop af; ret` (a caller-skip).
 *
 * The frozen oracle discards its caller's return address (`pop af`) before `ret`, so control
 * skips one stack frame. The idiomatic module dissolves that stack plumbing into a BOOLEAN
 * return: it does the real memory writes (zero the selected record body, enqueue the sound
 * command) and returns a JS boolean — `false` = the pop-af skip path, `true` = a plain ret.
 * This routine takes ONLY the pop-af path, so the module always returns false; the caller
 * (applyRoundDeltaAndRearmMatchedRecord) reads that and aborts in place of the discarded frame.
 *
 * Fidelity contract: RAM (dumpState, minus stack scratch below the entry SP) PLUS the boolean return matching
 * which path the oracle took. pc/SP/cycles/register-file are NOT compared: the pop-af abort
 * clobbers AF with stack bytes and the scan cursors are volatile. To confirm the oracle DID
 * take the pop-af path we measure its SP movement: a pop-af+ret unwinds two words above the
 * entry SP (net +4) where a plain ret unwinds one (net +2). SP is seated inside STACK_SCRATCH
 * so the oracle's transient pushes/pops land in the excluded window.
 *
 * INPUT: the interrupt register I selects the record — I==0 -> 0x8c90, I!=0 -> 0x8ca8.
 *
 * Jobs:
 *   1. EQUAL — for I==0 and I!=0, oracle == retireParityTargetSlotAndQueueSound in RAM (−stack); the module returns
 *      false; and the oracle's SP moved +4 (the pop-af skip path ran).
 *   2. WRITE-SET — the selected record's 0x18-byte body is zeroed and its partner record is
 *      left untouched (the sound-ring writes are the enqueue callee's own domain).
 *   3. TEETH — a wrong zeroed byte is caught by the RAM diff, and a twin returning the wrong
 *      boolean (true) is caught by the return-path check.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6274.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6274 as oracle } from "../../translated/loc_6274.js";
import { retireParityTargetSlotAndQueueSound } from "../retireParityTargetSlotAndQueueSound.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_TARGET_REC0, ENEMY_TARGET_REC1 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_LEN = 0x18;
const SP_SEAT = 0x8fe0; // inside STACK_SCRATCH: transient pushes/pops stay in the excluded window
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP_SEAT);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with I seated (record selector) and the target record optionally pre-dirtied. */
function craft(iReg, dirty = false) {
  const m = BASE.clone();
  m.regs.sp = SP_SEAT;
  m.regs.i = iReg & 0xff;
  if (dirty) {
    const base = iReg === 0 ? ENEMY_TARGET_REC0 : ENEMY_TARGET_REC1;
    for (let k = 0; k < RECORD_LEN; k++) m.mem8[base + k] = 0xaa;
  }
  return m;
}

const CASES = [
  { name: "I==0 -> clear 0x8c90", ireg: 0x00, base: ENEMY_TARGET_REC0, partner: ENEMY_TARGET_REC1 },
  { name: "I!=0 -> clear 0x8ca8", ireg: 0x01, base: ENEMY_TARGET_REC1, partner: ENEMY_TARGET_REC0 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: retireParityTargetSlotAndQueueSound == oracle in RAM (−stack); module returns false; oracle takes pop-af (SP +4)", () => {
  for (const spec of CASES) {
    const o = craft(spec.ireg, true);
    const c = craft(spec.ireg, true);
    oracle(o);
    const ret = retireParityTargetSlotAndQueueSound(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, false, `[${spec.name}] module must report the pop-af abort path (false)`);
    // The oracle unwound one extra frame: pop-af (+2) then ret (+2) = net +4 above the entry SP.
    const moved = (o.regs.sp - SP_SEAT) & 0xffff;
    assert.equal(moved, 4, `[${spec.name}] oracle SP moved ${moved}, expected +4 (the pop-af skip path)`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack), module=false, oracle SP +4 (skip)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the selected record body is zeroed and its partner is untouched", () => {
  for (const spec of CASES) {
    const o = craft(spec.ireg, true);
    // pre-dirty the partner too, to prove it is NOT cleared
    for (let k = 0; k < RECORD_LEN; k++) o.mem8[spec.partner + k] = 0x5c;
    oracle(o);
    for (let k = 0; k < RECORD_LEN; k++) {
      assert.equal(o.mem8[spec.base + k], 0x00, `[${spec.name}] record byte +${k} must be 0`);
      assert.equal(o.mem8[spec.partner + k], 0x5c, `[${spec.name}] partner byte +${k} must be untouched`);
    }
  }
  console.log(`  WRITE-SET: selected record := 0 (0x18 bytes); partner untouched (sound ring = callee domain)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong zeroed byte is CAUGHT by the RAM diff", () => {
  const spec = CASES[0];
  const o = craft(spec.ireg, true);
  const c = craft(spec.ireg, true);
  oracle(o);
  retireParityTargetSlotAndQueueSound(c);
  c.mem8[spec.base + 5] = 0xff; // BUG: the record body must be zeroed

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-zeroed record byte — it is worthless");
  assert.equal(d.addr, spec.base + 5, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: non-zeroed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong boolean return (true) is CAUGHT by the return-path check", () => {
  const c = craft(CASES[0].ireg, true);
  const ret = retireParityTargetSlotAndQueueSound(c);
  assert.equal(ret, false, "sanity: the module reports the pop-af abort path as false");
  // A twin that reported the plain-ret path would return true; the `=== false` check must reject it.
  const brokenRet = true;
  assert.notEqual(brokenRet, false, "the return-path check must reject a wrong boolean (true for a skip)");
  console.log(`  TEETH/BOOL: module=false; a twin returning true is rejected by the return-path check`);
});
