// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for startGameOnStartButtonPress (Pooyan) — a credit-gated trigger: choose a status byte,
 * bail if it is already active, and on a gate-bit press enqueue sound command 0 and tail into the
 * follow-on handler.
 *
 * startGameOnStartButtonPress is void on every bail and its fire path tails into the still-frozen follow-on handler
 * through a kept m.call, so no register survives; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack. startGameOnStartButtonPress ends in a tail dispatch, so it also carries an
 * SP-tooth. The two crafted states seat the trigger on its two arms: fire (credit present, status
 * clear, gate bits set) and gate-clear (no credit -> immediate return).
 *
 * Jobs:
 *   1. EQUAL — fire and gate-clear arms: oracle == startGameOnStartButtonPress in RAM (−stack).
 *   2. WRITE-SET — the credit gate gates the sound enqueue: fire writes the sound ring, gate-clear
 *      writes nothing.
 *   3. TEETH — a wrong byte at a written cell is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the tail dispatch is stack-placeable through the dispatch seam.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7fd6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7fd6 as oracle } from "../../translated/loc_7fd6.js";
import { startGameOnStartButtonPress } from "../startGameOnStartButtonPress.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CREDIT_COUNT = 0x8802; //  gate: zero -> immediate return
const TWO_PLAYER_FLAG = 0x880e; // zero -> status is the (zero) flag itself
const INPUT_PORT0 = 0x8810; //   the 0x18 gate bits; here bit 4 (fires, and lets the tail ret clean)
const SOUND_RING_WRITE_PTR = 0x8a40; // sound-ring cursor; a valid slot so the enqueue lands
const SP0 = 0x8ff0; //           inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //    caller-return word seated at SP0 for the seam/tail

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with a caller-return word at SP0; `credit` picks the fire vs gate-clear arm. */
function craft(credit) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.mem8[CREDIT_COUNT] = credit & 0xff;
  m.mem8[TWO_PLAYER_FLAG] = 0x00; // status = the (zero) flag -> never already-active
  m.mem8[INPUT_PORT0] = 0x10; // gate bit set; bit 3 clear -> the tail handler rets clean
  m.mem8[SOUND_RING_WRITE_PTR] = 0x50; // a valid ring cursor for the enqueue
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: fire + gate-clear arms — startGameOnStartButtonPress == oracle in RAM (−stack)", () => {
  for (const [label, credit] of [["fire (credit=1)", 0x01], ["gate-clear (credit=0)", 0x00]]) {
    const o = craft(credit);
    oracle(o);
    const c = craft(credit);
    startGameOnStartButtonPress(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: fire + gate-clear identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the credit gate gates the sound enqueue", () => {
  const firePre = craft(0x01).dumpState();
  const fire = craft(0x01);
  oracle(fire);
  const fireWrote = firstStateDiff(firePre, fire.dumpState(), (off) => fire.stateOffsetToAddr(off), inDeadStack);
  assert.notEqual(fireWrote, null, "fire path -> the sound enqueue must write RAM");

  const clearPre = craft(0x00).dumpState();
  const clear = craft(0x00);
  oracle(clear);
  const clearWrote = firstStateDiff(clearPre, clear.dumpState(), (off) => clear.stateOffsetToAddr(off), inDeadStack);
  assert.equal(clearWrote, null, "gate-clear path -> nothing written");
  console.log(`  WRITE-SET: fire writes at ${hx(fireWrote.addr ?? 0)}, gate-clear writes nothing`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong byte at a written cell is CAUGHT by the RAM diff", () => {
  const pre = craft(0x01).dumpState();
  const o = craft(0x01);
  oracle(o);
  const c = craft(0x01);
  startGameOnStartButtonPress(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: fire arm must match before the poke");
  const wrote = firstStateDiff(pre, o.dumpState(), (off) => o.stateOffsetToAddr(off), inDeadStack);
  c.mem8[wrote.addr] = (c.mem8[wrote.addr] ^ 0xff) & 0xff; // corrupt a cell the fire path wrote
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong written byte — it is worthless");
  console.log(`  TEETH/RAM: wrong byte caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the tail dispatch is stack-placeable through the seam", () => {
  const r = seamPlaceable(withOmittedRet, startGameOnStartButtonPress, 0x7fd6, craft(0x01));
  assert.equal(r.placeable, true, `tail dispatch must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: startGameOnStartButtonPress tail dispatch placeable (moved +2, pc on the caller slot)");
});
