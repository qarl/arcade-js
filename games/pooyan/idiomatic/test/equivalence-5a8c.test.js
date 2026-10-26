// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for addCreditsAndQueueDisplay (ROM 0x5a8c, Pooyan) — shared score-accumulate tail.
 *
 * SEATING: BALANCED — the incoming amount arrives in A (param default m.regs.a), the routine adds it
 * to the score byte, clamps to 0x63, and tails into queueCreditDisplayRefresh (dissolved) which queues a display
 * command. LIVE-OUT is memory only (score byte + display ring); no caller reads A back. SP parked in
 * STACK_SCRATCH. Cases: below-cap (no clamp), above-cap, exactly-at-cap.
 *
 * Jobs:
 *   1. EQUAL — every case: oracle == module in RAM (−stack).
 *   2. WRITE-SET — below-cap keeps the sum; above-cap clamps to 0x63.
 *   3. TEETH — a corrupted score byte is caught; a twin that skips the clamp diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5a8c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5a8c as oracle } from "../../translated/loc_5a56.js";
import { addCreditsAndQueueDisplay } from "../addCreditsAndQueueDisplay.js";
import { queueCreditDisplayRefresh } from "../queueCreditDisplayRefresh.js";
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

/** Seat the score byte + display ring (enqueue path) with SP in dead scratch; A = the amount. */
function seat(m, { amount, score }) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.a = amount;
  m.mem.write8(CREDIT_COUNT, score);
  m.mem.write8(RING_PTR, 0xc0);
  m.mem.write8(SLOT, 0x80);
  return m;
}

const CASES = {
  "below cap": { amount: 0x01, score: 0x10 }, // sum 0x11 < 0x63
  "above cap": { amount: 0x63, score: 0x10 }, // sum 0x73 -> clamp 0x63
  "exactly at cap": { amount: 0x03, score: 0x60 }, // sum 0x63 -> clamp 0x63
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: addCreditsAndQueueDisplay == oracle in RAM (−stack)", () => {
  for (const [name, cfg] of Object.entries(CASES)) {
    const o = seat(BASE.clone(), cfg);
    const c = seat(BASE.clone(), cfg);
    oracle(o);
    addCreditsAndQueueDisplay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: below-cap keeps the sum; above-cap clamps to 0x63", () => {
  const below = seat(BASE.clone(), CASES["below cap"]);
  addCreditsAndQueueDisplay(below);
  assert.equal(below.mem.read8(CREDIT_COUNT), 0x11, "0x01 + 0x10 = 0x11 (no clamp)");

  const above = seat(BASE.clone(), CASES["above cap"]);
  addCreditsAndQueueDisplay(above);
  assert.equal(above.mem.read8(CREDIT_COUNT), 0x63, "0x63 + 0x10 clamps to 0x63");
  console.log("  WRITE-SET: sum kept below cap; clamped above");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted score byte is CAUGHT by the RAM diff", () => {
  const o = seat(BASE.clone(), CASES["below cap"]);
  const c = seat(BASE.clone(), CASES["below cap"]);
  oracle(o);
  addCreditsAndQueueDisplay(c);
  c.mem.write8(CREDIT_COUNT, (o.mem.read8(CREDIT_COUNT) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the clamp diverges on the above-cap case", () => {
  const cfg = CASES["above cap"];
  const o = seat(BASE.clone(), cfg);
  const t = seat(BASE.clone(), cfg);
  oracle(o);
  // twin: add without clamping, then the same display-command tail -> only the score byte differs
  t.mem.write8(CREDIT_COUNT, (cfg.amount + cfg.score) & 0xff);
  queueCreditDisplayRefresh(t);
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "a skipped clamp must be caught by the RAM diff");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(twin): caught at ${hx(d.addr)}`);
});
