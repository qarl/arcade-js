// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceObjectFallStepThenBlankBandOnLand (ROM 0x4364) — an object state handler. While the record's
 * phase timer (ix+0x11) is non-zero it counts it down one and returns; once the timer is zero it
 * steps the animation sequencer (advanceObjectAnimationFrame), advances one fall step (loc_3fd5 / advanceFallStep,
 * whose carry = "still airborne"), returns while airborne, and on landing tail-blanks the sprite
 * band (blankActorSpriteBand zeroes 0x17 bytes from ix).
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case uses a FRESH clone
 * per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — advanceObjectFallStepThenBlankBandOnLand is a table-dispatched
 * handler (sibling countdownThenRearmTurnAnimationByFlag) and no caller consumes a result register; the exit registers/flags
 * differ per path (A + flags on the timer path, carry on the airborne path, the tail callee's HL/B
 * on the landing path), so there is NO declared register live-out. pc/SP/cycles are NOT compared.
 *
 * The record is based at IX; the leaf runs only during live object updates, so every case is
 * CRAFTED. The record is pre-dirtied to 0xAA and the four fields advanceObjectFallStepThenBlankBandOnLand's callees read are seated
 * identically on both sides: the animation hold (ix+0x0e, non-zero so advanceObjectAnimationFrame just decrements it),
 * the fall fraction/velocity (ix+0x03 / ix+0x09, both 0 so no row carries), and the integer row
 * (ix+0x04) — below 0x1e = airborne, at 0x1e = landed.
 *
 * Jobs:
 *   1. EQUAL — timer-running, airborne, and landing exits: advanceObjectFallStepThenBlankBandOnLand == oracle in RAM (−stack).
 *   2. WRITE-SET — the timer-running path's ONLY write is the phase timer, decremented by one.
 *   3. TEETH — a twin that forgets the timer decrement MUST be caught at ix+0x11; a twin that leaves
 *      a byte of the sprite band un-blanked on the landing path MUST be caught in the band.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-4364.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4364 as oracle } from "../../translated/loc_4364.js";
import { advanceObjectFallStepThenBlankBandOnLand } from "../advanceObjectFallStepThenBlankBandOnLand.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0;    // work-RAM record base (IX)
const REC_LEN = 0x18;
const TIMER = 0x11;    // phase-timer offset (ix+0x11)
const HOLD = 0x0e;     // animation-hold offset advanceObjectAnimationFrame decrements
const FRAC = 0x03;     // fall fraction
const ROW = 0x04;      // integer row
const VEL = 0x09;      // fall velocity
const BAND_LEN = 0x17; // bytes blankActorSpriteBand blanks from the record base
const LANDING_ROW = 0x1e;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x20);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: record pre-dirtied to 0xAA, callee-read fields seated, IX=REC, SP in scratch. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0xaa);
  m.mem.write8(REC + HOLD, 0x03); // non-zero: advanceObjectAnimationFrame just decrements the hold this frame
  m.mem.write8(REC + FRAC, 0x00);
  m.mem.write8(REC + VEL, 0x00);  // fraction + velocity 0 -> the fall step carries no row
  m.mem.write8(REC + ROW, scn.row);
  m.mem.write8(REC + TIMER, scn.timer);
  m.regs.ix = REC;
  m.regs.sp = STACK_SCRATCH.hi - 0x20; // the callees push/pop here (dead-stack scratch)
  return m;
}

const CASES = [
  { name: "timer-running", timer: 0x05, row: 0x10 }, // timer != 0 -> dec + return, advanceObjectAnimationFrame NOT called
  { name: "airborne",      timer: 0x00, row: 0x10 }, // timer 0, row < 0x1e -> ret c (still falling)
  { name: "landing",       timer: 0x00, row: LANDING_ROW }, // timer 0, row == 0x1e -> tail-blank the band
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: timer-running + airborne + landing — advanceObjectFallStepThenBlankBandOnLand == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advanceObjectFallStepThenBlankBandOnLand(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the timer-running path's only write is the phase timer (−1)", () => {
  const scn = CASES[0];
  const before = craft(scn);
  const after = craft(scn);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  const nonStack = changed.filter((a) => !inDeadStack(a));
  assert.deepEqual(nonStack, [REC + TIMER], `expected only ${hx(REC + TIMER)} to change, got ${nonStack.map(hx).join(",")}`);
  assert.equal(after.mem.read8(REC + TIMER), (scn.timer - 1) & 0xff, "phase timer decremented by one");
  console.log(`  WRITE-SET: only ${hx(REC + TIMER)} changes (${hx(scn.timer)} -> ${hx(scn.timer - 1)})`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a forgotten timer decrement is CAUGHT at ix+0x11", () => {
  const scn = CASES[0];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceObjectFallStepThenBlankBandOnLand(c);
  c.mem.write8(REC + TIMER, scn.timer); // BUG: leave the phase timer un-decremented

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a forgotten timer decrement — it is worthless");
  assert.equal(d.addr, REC + TIMER, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(REC + TIMER)})`);
  console.log(`  TEETH: forgotten timer dec caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: an un-blanked sprite-band byte is CAUGHT on the landing path", () => {
  const scn = CASES[2]; // landing -> blankActorSpriteBand zeroes the band
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceObjectFallStepThenBlankBandOnLand(c);
  // positive control: the oracle really did clear this band cell to 0
  assert.equal(o.mem.read8(REC + 0x05), 0x00, "control: oracle blanked the band on landing");
  c.mem.write8(REC + 0x05, 0xaa); // BUG: a band byte left un-blanked

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an un-blanked band byte — it is worthless");
  assert.equal(d.addr, REC + 0x05, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  assert.ok(0x05 < BAND_LEN, "the poked cell is inside the blanked band");
  console.log(`  TEETH: un-blanked band byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
