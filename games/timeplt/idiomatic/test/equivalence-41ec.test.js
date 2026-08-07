// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_41ec — memory-equivalent to the frozen oracle at ROM 0x41EC.
 *
 * GATE: crafted-entry over painted record bands, because the strict gate CANNOT run here. The one
 *   call site is `call c,0x41EC` at 0x41D8, and it fires only when BOTH distances 0x33B8 measures
 *   come back under sixteen — the object already on top of the point it is steering to. Neither
 *   the shared coin -> start tape nor undriven attract produces that in 4000 frames: zero
 *   dispatches on both. unitEquivalence throws "never entered", and the first arm ASSERTS the
 *   throw rather than raising the budget past what the harness exports.
 *
 *   The entry is built rather than captured: a REAL machine cloned at the end of the shared tape's
 *   session, with only the record pointer moved and a band around it painted.
 *
 * WHY THE BAND IS PAINTED. The routine's whole effect is one zero-store, and on a live backdrop
 *   the target byte is often ALREADY zero — a gate on that entry passes a candidate that does
 *   nothing. So each crafted case paints an address-derived, non-zero marker over the record and
 *   several bytes either side. That makes the store visible AND makes a wrong offset visible, and
 *   the DEGENERATE arm measures how much of the unpainted backdrop would have been blind.
 *
 * What it exercises, holes stated:
 *   1. UNREACHED, ASSERTED — the strict harness throws on both tapes.
 *   2. EVERY RECORD BASE the object arrays use — the player, the eight actor slots and the eight
 *      scenery slots — each with a painted band, oracle against rewrite, full state dump.
 *   3. EXHAUSTIVE over priors — all 256 values of the target byte at one base.
 *   4. PARAMETER FORM — the rewrite takes the record as an argument with the register as its
 *      default; both forms are asserted to agree.
 *   5. THE PINNED TWIN — an implementation that ignores its pointer and hard-codes one record's
 *      byte. It must SURVIVE that one base and DIE on every other, which is the distinction a
 *      single-base gate cannot draw.
 *   6. TEETH — no-op, the offsets either side, and a store of one instead of zero.
 *
 * HOLE: the paint is a band of nine bytes centred on the record base, so a wrong offset landing
 * outside it would not be caught; and coverage is the bases the object arrays use, not every
 * address a caller could pass. Nothing here establishes what the zeroed byte counts down — other
 * routines in the same family decrement it, floor it and re-arm it, and none of that is observed
 * from this file.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-41ec.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_41ec } from "../loc_41ec.js";
import { loc_41ec as oracle } from "../../translated/loc_41ec.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { u16 } from "../../../../core/int.js";

const TARGET = 0x41ec;
const COUNTDOWN_IN_RECORD = 4;
const PAINT_EITHER_SIDE = 4;

/** The record bases the object arrays use: the player, the actor band, the scenery band. */
const RECORD_BASES = [
  0xa800,
  0xa810, 0xa820, 0xa830, 0xa840, 0xa850, 0xa860, 0xa870, 0xa880,
  0xa900, 0xa910, 0xa920, 0xa930, 0xa940, 0xa950, 0xa960, 0xa970,
];

const SKIP = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

let backdrop = null;

/** A real end-of-session machine, produced by the shared tape and nothing else. */
function pristine() {
  if (backdrop === null) {
    const m = makeMachine();
    m.runFrames(ENTRY_FRAMES);
    backdrop = m.clone();
  }
  return backdrop;
}

/** A non-zero marker derived from the address, so no two painted bytes collide. */
const marker = (addr) => ((addr & 0xff) ^ 0x5a) || 0x5a;

function craft(record, prior) {
  const m = pristine().clone();
  m.regs.ix = record;
  for (let d = -PAINT_EITHER_SIDE; d <= COUNTDOWN_IN_RECORD + PAINT_EITHER_SIDE; d++) {
    const addr = u16(record + d);
    m.mem8[addr] = marker(addr);
  }
  if (prior !== undefined) m.mem8[u16(record + COUNTDOWN_IN_RECORD)] = prior;
  return m;
}

function compare(candidate, record, prior) {
  const a = craft(record, prior);
  const b = craft(record, prior);
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

// ── the routine is unreached, and that is asserted ──────────────────────────────────────────

test("UNREACHED: neither tape dispatches it, so the strict harness throws", { skip: SKIP }, () => {
  for (const [label, opts] of [["coin -> start", {}], ["undriven attract", { tape: [] }]]) {
    assert.throws(
      () => unitEquivalence((ov) => makeMachine(ov, opts), TARGET, oracle, loc_41ec, {
        maxFrames: ENTRY_FRAMES,
      }),
      /never entered/,
      `${label} unexpectedly reached the routine — the crafted gate should become a real capture`,
    );
  }
  console.log("  UNREACHED: both tapes throw 'never entered' — crafted entries it is");
});

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EVERY RECORD BASE: painted band, RAM identical", { skip: SKIP }, () => {
  for (const record of RECORD_BASES) {
    const d = compare(loc_41ec, record);
    assert.equal(d, null, `record ${hex4(record)}: ${show(d)}`);
  }
  console.log(`  BASES: ${RECORD_BASES.length} record bases identical`);
});

test("EXHAUSTIVE over priors: every value of the target byte", { skip: SKIP }, () => {
  const record = RECORD_BASES[1];
  let swept = 0;
  for (let prior = 0; prior < 256; prior++) {
    const d = compare(loc_41ec, record, prior);
    assert.equal(d, null, `prior=${prior}: ${show(d)}`);
    swept++;
  }
  assert.equal(swept, 256, "must have swept every prior");
  console.log(`  EXHAUSTIVE: ${swept} priors identical at ${hex4(record)}`);
});

/** The same comparison with the band left UNPAINTED — the state the game itself produced. */
function compareUnpainted(candidate, record) {
  const make = () => {
    const m = pristine().clone();
    m.regs.ix = record;
    return m;
  };
  const a = make();
  const b = make();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

test("DEGENERATE, MEASURED: the paint is what gives this gate teeth", { skip: SKIP }, () => {
  const survivedUnpainted = RECORD_BASES.filter((r) => compareUnpainted(brokenNoOp, r) === null);
  const survivedPainted = RECORD_BASES.filter((r) => compare(brokenNoOp, r) === null);
  assert.ok(
    survivedUnpainted.length > 0,
    "if the raw backdrop already catches a no-op everywhere, this header's reason for painting is stale",
  );
  assert.equal(survivedPainted.length, 0, "with the band painted, no base may let a no-op through");
  console.log(
    `  DEGENERATE: a no-op survives ${survivedUnpainted.length} of ${RECORD_BASES.length} bases on ` +
      `the raw backdrop and ${survivedPainted.length} with the band painted`,
  );
});

test("PARAMETER FORM: the argument and the register agree", { skip: SKIP }, () => {
  const record = RECORD_BASES[2];
  const viaRegister = craft(record, 0x7e);
  loc_41ec(viaRegister);

  const viaArgument = craft(record, 0x7e);
  viaArgument.regs.ix = 0x0000;
  loc_41ec(viaArgument, record);

  const d = firstStateDiff(viaRegister.dumpState(), viaArgument.dumpState(), (off) =>
    viaRegister.stateOffsetToAddr(off),
  );
  assert.equal(d, null, `the two forms diverged — ${show(d)}`);
  console.log(`  PARAMETER FORM: argument and register agree at ${hex4(record)}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────

/** BUG: does nothing. */
function brokenNoOp() {}

/** BUG: zeroes the byte before the countdown. */
function brokenOffsetBelow(m, record = m.regs.ix) {
  m.mem8[u16(record + COUNTDOWN_IN_RECORD - 1)] = 0;
}

/** BUG: zeroes the byte after the countdown. */
function brokenOffsetAbove(m, record = m.regs.ix) {
  m.mem8[u16(record + COUNTDOWN_IN_RECORD + 1)] = 0;
}

/** BUG: stores one rather than zero. */
function brokenNonZero(m, record = m.regs.ix) {
  m.mem8[u16(record + COUNTDOWN_IN_RECORD)] = 1;
}

/** BUG: ignores the pointer and hard-codes the base the first crafted case happens to use. */
function brokenPinned(m) {
  m.mem8[u16(RECORD_BASES[0] + COUNTDOWN_IN_RECORD)] = 0;
}

for (const [label, twin] of [
  ["no-op", brokenNoOp],
  ["offset-one-below", brokenOffsetBelow],
  ["offset-one-above", brokenOffsetAbove],
  ["writes-one-not-zero", brokenNonZero],
]) {
  test(`TEETH: the ${label} twin is CAUGHT at every base`, { skip: SKIP }, () => {
    let caught = 0;
    for (const record of RECORD_BASES) if (compare(twin, record)) caught++;
    assert.equal(caught, RECORD_BASES.length, `the ${label} twin survived somewhere`);
    console.log(`  TEETH/${label}: caught at all ${caught} bases`);
  });
}

test("TEETH: the pinned twin SURVIVES its one base and DIES on the others", { skip: SKIP }, () => {
  assert.equal(compare(brokenPinned, RECORD_BASES[0]), null, "it must survive the base it pins");
  let died = 0;
  for (const record of RECORD_BASES.slice(1)) if (compare(brokenPinned, record)) died++;
  assert.equal(died, RECORD_BASES.length - 1, "it must die on every other base");
  console.log(`  TEETH/pinned: survives ${hex4(RECORD_BASES[0])}, dies on the other ${died}`);
});
