// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickAttractDelayThenReseedAndAdvance (ROM 0x0986) — "attract sub-state 3": a per-frame
 * countdown gate. Decrement the script frame timer (0x8e50) and, only on the tick it reaches
 * zero, zero the board-init RAM (zeroSpriteListAndActorArena), re-arm the tile fill (armTileFillFromPlayfieldBase), advance the
 * attract sub-state (0x8e51), and seat 0x0b26 into the 0x8f48 attract cursor word.
 *
 * Cycle-free memory-equivalence gate: fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP) only. The routine has NO register live-out — its dispatcher (dispatchAttractSubstate) resumes
 * in the shared epilogue advanceGameStateOnCreditOrStartPress, which reloads its registers from memory — so pc and the whole
 * register file are deliberately NOT compared.
 *
 * Jobs:
 *   1. EQUAL (crafted) — the still-counting path and the timer-elapsed path: oracle == tickAttractDelayThenReseedAndAdvance
 *      in RAM (−stack). Every case is crafted (the leaf runs only in live attract).
 *   2. WRITE-SET — still-counting writes exactly the one timer cell; the elapsed path lands the
 *      sub-state bump and the 16-bit cursor seed 0x0b26 at 0x8f48/0x8f49.
 *   3. TEETH — a twin with a wrong cursor high byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0986.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0986 as oracle } from "../../translated/loc_0986.js";
import { tickAttractDelayThenReseedAndAdvance } from "../tickAttractDelayThenReseedAndAdvance.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SCRIPT_FRAME_TIMER, ATTRACT_SUBSTATE, INTRO_DELAY_CKSUM_WORD } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SCRIPT_TABLE_BASE = 0x0b26; // the ROM word-table base seeded into the 0x8f48 cursor
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the timer and observable neighbour cells seated. */
function craft(timer) {
  const m = BASE.clone();
  m.mem.write8(SCRIPT_FRAME_TIMER, timer);
  m.mem.write8(ATTRACT_SUBSTATE, 0x03); // a known sub-state so the inc is observable
  m.mem.write8(INTRO_DELAY_CKSUM_WORD, 0x00); // pre-clear the cursor word so the seed shows
  m.mem.write8(INTRO_DELAY_CKSUM_WORD + 1, 0x00);
  m.regs.sp = 0x8ffe;
  return m;
}

const CASES = [
  { timer: 0x05 }, // still counting -> single decrement
  { timer: 0x03 }, // still counting -> single decrement
  { timer: 0x01 }, // reaches zero -> full body runs
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted timer cases — tickAttractDelayThenReseedAndAdvance == oracle in RAM (−stack)", () => {
  for (const { timer } of CASES) {
    const o = craft(timer);
    oracle(o);
    const c = craft(timer);
    tickAttractDelayThenReseedAndAdvance(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (timer=${hx(timer)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: still-counting writes only the timer; elapsed bumps sub-state + seeds 0x8f48", () => {
  // Still-counting: exactly one cell changes.
  const run = craft(0x05);
  const b0 = run.dumpState();
  oracle(run);
  const a1 = run.dumpState();
  const counting = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) counting.push(run.stateOffsetToAddr(off));
  }
  assert.deepEqual(counting, [SCRIPT_FRAME_TIMER], "still-counting writes only the timer cell");
  assert.equal(run.mem.read8(SCRIPT_FRAME_TIMER), 0x04, "timer decremented to 0x04");

  // Elapsed: the sub-state advances and the cursor word gets the 16-bit seed.
  const done = craft(0x01);
  oracle(done);
  assert.equal(done.mem.read8(SCRIPT_FRAME_TIMER), 0x00, "timer landed on zero");
  assert.equal(done.mem.read8(ATTRACT_SUBSTATE), 0x04, "sub-state advanced 0x03 -> 0x04");
  assert.equal(done.mem.read8(INTRO_DELAY_CKSUM_WORD), SCRIPT_TABLE_BASE & 0xff, "cursor low byte := 0x26");
  assert.equal(done.mem.read8(INTRO_DELAY_CKSUM_WORD + 1), (SCRIPT_TABLE_BASE >> 8) & 0xff, "cursor high byte := 0x0b");
  console.log("  WRITE-SET: counting=1 cell; elapsed bumps 0x8e51 + seeds 0x8f48=0x0b26");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cursor high byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  tickAttractDelayThenReseedAndAdvance(c);
  c.mem.write8(INTRO_DELAY_CKSUM_WORD + 1, 0x00); // BUG: cursor high byte must be 0x0b, not 0x00
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cursor high byte — it is worthless");
  assert.equal(d.addr, INTRO_DELAY_CKSUM_WORD + 1, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong cursor high byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
