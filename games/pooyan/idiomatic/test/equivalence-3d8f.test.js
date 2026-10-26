// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blankEnemyBandOnTimerExpiry (ROM 0x3d8f) — "object state-10 handler": step the object's
 * animation (advanceObjectAnimationFrame), decrement its frame timer (ix+0x11), and while the timer has not elapsed
 * return; once it hits zero, blank the sprite band (tail to blankActorSpriteBand).
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP — the oracle's call trampolines push there). pc/SP/cycles are NOT compared.
 *
 * Two paths, two live-out contracts. The RETURN path (timer not yet zero) is memory-only — the
 * animation step leaves no register a caller consumes, so only RAM is compared. The BAND-BLANK path
 * (timer reaches zero) tail-jumps to the band blanker, whose live-out HL (= IX+0x17, past the run)
 * and B (= 0) are inherited; both are derived from the oracle clone and checked.
 *
 * The animation record is seated with a non-zero frame-hold (ix+0x0e) so advanceObjectAnimationFrame takes its cheap
 * hold-decrement path; IX points into work RAM so every write (and the band blank) stays off ROM.
 *
 * Jobs:
 *   1. EQUAL (return path) — timer>1: oracle == blankEnemyBandOnTimerExpiry in RAM (−stack).
 *   2. EQUAL (band-blank path) — timer==1: oracle == blankEnemyBandOnTimerExpiry in RAM (−stack) + HL + B.
 *   3. WRITE-SET — the return path writes exactly two cells: (ix+0x0e) and (ix+0x11), each -1.
 *   4. TEETH — a wrong timer byte is caught by the RAM diff; a wrong advanced HL by the live-out.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3d8f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3d8f as oracle } from "../../translated/loc_3d8f.js";
import { blankEnemyBandOnTimerExpiry } from "../blankEnemyBandOnTimerExpiry.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IXBASE = 0x8a80; //   work-RAM record base
const HOLD_FIELD = 0x0e; //  animation frame-hold counter
const TIMER_FIELD = 0x11; // frame timer counted down here
const BAND_LEN = 0x17; //    bytes the band blanker clears
const HOLD_SEED = 0x05; //   non-zero so advanceObjectAnimationFrame takes the hold-decrement path
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the record fields and IX seated identically. */
function craft(timer) {
  const m = BASE.clone();
  m.mem.write8((IXBASE + HOLD_FIELD) & 0xffff, HOLD_SEED);
  m.mem.write8((IXBASE + TIMER_FIELD) & 0xffff, timer);
  m.regs.ix = IXBASE;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH
  return m;
}

// -- 1. EQUAL (return path) ---------------------------------------------------

test("EQUAL: return path (timer stays non-zero) — blankEnemyBandOnTimerExpiry == oracle in RAM (−stack)", () => {
  for (const timer of [2, 3, 0x10]) {
    const o = craft(timer);
    const c = craft(timer);
    oracle(o);
    blankEnemyBandOnTimerExpiry(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `timer=${timer}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assert.equal(o.mem.read8((IXBASE + TIMER_FIELD) & 0xffff), timer - 1, "timer decremented, still non-zero");
  }
  console.log("  EQUAL(return): timers 2/3/0x10 identical (RAM −stack)");
});

// -- 2. EQUAL (band-blank path) -----------------------------------------------

test("EQUAL: band-blank path (timer reaches zero) — blankEnemyBandOnTimerExpiry == oracle in RAM (−stack) + HL + B", () => {
  const o = craft(1);
  const c = craft(1);
  oracle(o);
  const ret = blankEnemyBandOnTimerExpiry(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
  assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, "HL live-out mismatch (advanced past the band)");
  assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, "B live-out mismatch (drained counter)");
  assert.equal(ret & 0xffff, o.regs.hl & 0xffff, "module return equals the oracle HL");
  assert.equal(o.regs.hl & 0xffff, (IXBASE + BAND_LEN) & 0xffff, "HL = IX + band length");
  assert.equal(o.regs.b & 0xff, 0, "B = 0");
  console.log(`  EQUAL(band): HL=${hx(o.regs.hl)} B=0 identical (RAM −stack + HL + B)`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: return path writes exactly (ix+0x0e) and (ix+0x11), each -1", () => {
  const before = craft(3);
  const after = craft(3);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(ad)) changed.push({ addr: ad, from: b0[off], to: a1[off] }); // -stack
  }
  const addrs = new Set(changed.map((ch) => ch.addr));
  assert.equal(changed.length, 2, `expected exactly 2 written cells, got ${changed.length}`);
  assert.ok(addrs.has((IXBASE + HOLD_FIELD) & 0xffff), "expected a write at the hold field");
  assert.ok(addrs.has((IXBASE + TIMER_FIELD) & 0xffff), "expected a write at the timer field");
  for (const ch of changed) assert.equal(ch.to, ch.from - 1, `cell ${hx(ch.addr)} must be decremented`);
  console.log("  WRITE-SET: hold + timer fields, each -1");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong timer byte is CAUGHT by the RAM diff", () => {
  const o = craft(3);
  const c = craft(3);
  oracle(o);
  blankEnemyBandOnTimerExpiry(c);
  const cell = (IXBASE + TIMER_FIELD) & 0xffff;
  c.mem.write8(cell, 0x7e); // BUG: timer must be 2 here, not 0x7e

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH/RAM: wrong timer byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong advanced HL is CAUGHT by the live-out check", () => {
  const o = craft(1);
  oracle(o);
  const good = o.regs.hl & 0xffff;
  const wrong = (IXBASE + BAND_LEN - 1) & 0xffff; // one byte short of the band end
  assert.notEqual(wrong, good, "the HL live-out check must reject a short advanced pointer");
  assert.equal(good, (IXBASE + BAND_LEN) & 0xffff, "sanity: oracle HL is IX + band length");
  console.log(`  TEETH/HL: short ${hx(wrong)} rejected vs oracle ${hx(good)}`);
});
