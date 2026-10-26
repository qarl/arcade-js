// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickActorHoldThenBlankAndClearWaveLatches (ROM 0x3536, Pooyan) — "actor frame-hold tick".
 *
 * The routine advances the record's animation (advanceObjectAnimationFrame), then decrements the record's frame-hold
 * field (+0x11). While it is still holding (nonzero after the decrement) it returns and the frame
 * stays — the ONLY path that does not blank the sprite band. Once the hold lapses, and only when
 * the record's flag byte (+0x07) has a set high nibble, a shared tally (loc_8d76) is bumped; on the
 * third such bump the lane-spawn countdown and the launch arm latch are cleared. Every non-holding
 * exit tail-calls the band-blank (blankActorSpriteBand), zeroing the 0x17-byte record band.
 *
 * CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). Each case runs the oracle on one
 * FRESH clone and tickActorHoldThenBlankAndClearWaveLatches on another and compares:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * NO register live-out is declared: the dispatch caller parks and restores its own loop registers
 * (B/DE) around this tick with exx and reads none of ours, so hold-vs-blank is entirely a RAM effect.
 * pc/SP are NOT compared; SP is seated in the dead stack. The oracle dispatches its m.call sub-routines
 * through the TRANSLATED registry; tickActorHoldThenBlankAndClearWaveLatches imports the idiomatic ones. IX (the record) is the one input.
 *
 * Jobs (one per branch):
 *   1. EQUAL — holding, expired-no-flag, tally-bump (<3), and tally-reset (>=3) all agree in RAM(−stack).
 *   2. WRITE-SET — the reset branch bumps the tally to 3, clears the lane countdown and launch latch,
 *      and zeroes the whole record band; documents the reset footprint.
 *   3. TEETH — a twin that skips the lane-countdown clear is caught; a wrong band byte is caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3536.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3536 as oracle } from "../../translated/loc_3536.js";
import { tickActorHoldThenBlankAndClearWaveLatches } from "../tickActorHoldThenBlankAndClearWaveLatches.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, LANE_SPAWN_COUNTDOWN, LAUNCH_ARM_LATCH, loc_8d76 } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; // an actor record base clear of STACK_SCRATCH
const BAND_LEN = 0x17; // bytes blankActorSpriteBand blanks from the record base
const HOLD_4006 = 0x0e; // advanceObjectAnimationFrame's own frame-hold field
const HOLD_3536 = 0x11; // tickActorHoldThenBlankAndClearWaveLatches's frame-hold field
const FLAG_FIELD = 0x07; // flag byte; high nibble gates the tally bump
const DIRT = 0xaa;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * A fresh clone set up for one branch: `hold3536` (2 => still holds after the dec; 1 => expires),
 * `flagHi` (high nibble of +0x07), and `tally` (the pre-inc loc_8d76 value). The band is pre-dirtied
 * and the two clearable latches pre-set so their clearing is observable.
 */
function craft({ hold3536, flagHi, tally }) {
  const m = BASE.clone();
  m.regs.sp = STACK_SCRATCH.hi;
  m.regs.ix = REC;
  for (let i = 0; i < BAND_LEN; i++) m.mem.write8((REC + i) & 0xffff, DIRT);
  m.mem.write8(REC + HOLD_4006, 0x05); // advanceObjectAnimationFrame just decrements this and returns
  m.mem.write8(REC + HOLD_3536, hold3536);
  m.mem.write8(REC + FLAG_FIELD, flagHi);
  m.mem.write8(loc_8d76, tally);
  m.mem.write8(LANE_SPAWN_COUNTDOWN, DIRT);
  m.mem.write8(LAUNCH_ARM_LATCH, DIRT);
  return m;
}

const BRANCHES = {
  holding: { hold3536: 0x02, flagHi: 0x10, tally: 0x02 }, // dec -> 1, still holding: no blank
  expiredNoFlag: { hold3536: 0x01, flagHi: 0x00, tally: 0x02 }, // expires, flag clear: blank only
  bump: { hold3536: 0x01, flagHi: 0x10, tally: 0x01 }, // expires, flag set, tally 1->2 (<3)
  reset: { hold3536: 0x01, flagHi: 0x10, tally: 0x02 }, // expires, flag set, tally 2->3 (>=3): clear latches
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: tickActorHoldThenBlankAndClearWaveLatches == oracle in RAM (−stack) across all four branches", () => {
  for (const [name, cfg] of Object.entries(BRANCHES)) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    tickActorHoldThenBlankAndClearWaveLatches(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: holding / expiredNoFlag / bump / reset identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the reset branch bumps the tally to 3, clears both latches, zeroes the band", () => {
  const m = craft(BRANCHES.reset);
  oracle(m);
  assert.equal(m.mem.read8(loc_8d76), 0x03, "tally bumped to 3");
  assert.equal(m.mem.read8(LANE_SPAWN_COUNTDOWN), 0x00, "lane-spawn countdown cleared");
  assert.equal(m.mem.read8(LAUNCH_ARM_LATCH), 0x00, "launch arm latch cleared");
  for (let i = 0; i < BAND_LEN; i++) {
    assert.equal(m.mem.read8((REC + i) & 0xffff), 0x00, `band cell ${hx(REC + i)} not blanked`);
  }
  console.log("  WRITE-SET: tally=3, lane countdown + launch latch cleared, band zeroed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a skipped lane-countdown clear is CAUGHT by the RAM diff", () => {
  const o = craft(BRANCHES.reset);
  const c = craft(BRANCHES.reset);
  oracle(o);
  tickActorHoldThenBlankAndClearWaveLatches(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  c.mem.write8(LANE_SPAWN_COUNTDOWN, DIRT); // BUG: the reset must clear this to 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped latch clear — it is worthless");
  assert.equal(d.addr, LANE_SPAWN_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/reset: skipped lane-countdown clear caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong band byte is CAUGHT by the RAM diff", () => {
  const o = craft(BRANCHES.expiredNoFlag);
  const c = craft(BRANCHES.expiredNoFlag);
  oracle(o);
  tickActorHoldThenBlankAndClearWaveLatches(c);
  assert.equal(ramDiffMinusStack(o, c), null, "module agrees before the injected bug");
  const cell = (REC + BAND_LEN - 1) & 0xffff;
  c.mem.write8(cell, DIRT); // BUG: last band cell must be 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong band byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH/band: wrong band byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
