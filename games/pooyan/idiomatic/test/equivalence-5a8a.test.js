// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for addFullWrapCreditAmount (ROM 0x5a8a, Pooyan) — full-wrap entry into the accumulate tail.
 *
 * SEATING: BALANCED — seeds the accumulate amount to the wrap constant (0x63) and falls into addCreditsAndQueueDisplay
 * (dissolved), which adds it to the score byte, clamps, and queues a display command. LIVE-OUT is
 * memory only; SP parked in STACK_SCRATCH. Both layers seed the same amount, so RAM agrees.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack), for two starting score bytes.
 *   2. WRITE-SET — a low starting score accumulates by 0x63; a high one clamps to 0x63.
 *   3. TEETH — a corrupted score byte is caught; a twin seeding a different amount diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5a8a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5a8a as oracle } from "../../translated/loc_5a56.js";
import { addFullWrapCreditAmount } from "../addFullWrapCreditAmount.js";
import { addCreditsAndQueueDisplay } from "../addCreditsAndQueueDisplay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, CREDIT_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING_PTR = 0x88a0;
const SLOT = 0x88c0;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, score) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.mem.write8(CREDIT_COUNT, score);
  m.mem.write8(RING_PTR, 0xc0);
  m.mem.write8(SLOT, 0x80);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: addFullWrapCreditAmount == oracle in RAM (−stack)", () => {
  for (const score of [0x00, 0x40]) {
    const o = seat(BASE.clone(), score);
    const c = seat(BASE.clone(), score);
    oracle(o);
    addFullWrapCreditAmount(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `score=${hx(score)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: full-wrap seed identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: low score accumulates by 0x63; high score clamps to 0x63", () => {
  const low = seat(BASE.clone(), 0x00);
  addFullWrapCreditAmount(low);
  assert.equal(low.mem.read8(CREDIT_COUNT), 0x63, "0x63 + 0x00 = 0x63");

  const high = seat(BASE.clone(), 0x40);
  addFullWrapCreditAmount(high);
  assert.equal(high.mem.read8(CREDIT_COUNT), 0x63, "0x63 + 0x40 clamps to 0x63");
  console.log("  WRITE-SET: +0x63 then clamp");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted score byte is CAUGHT by the RAM diff", () => {
  const o = seat(BASE.clone(), 0x00);
  const c = seat(BASE.clone(), 0x00);
  oracle(o);
  addFullWrapCreditAmount(c);
  c.mem.write8(CREDIT_COUNT, (o.mem.read8(CREDIT_COUNT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin seeding a different amount diverges from the oracle", () => {
  const o = seat(BASE.clone(), 0x00);
  const t = seat(BASE.clone(), 0x00);
  oracle(o);
  addCreditsAndQueueDisplay(t, 0x62); // wrong wrap amount -> different score byte
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "a wrong seed amount must be caught by the RAM diff");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(twin): caught at ${hx(d.addr)}`);
});
