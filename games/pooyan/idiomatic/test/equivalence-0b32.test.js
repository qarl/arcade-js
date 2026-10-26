// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceAttractSequenceToPlay (ROM 0x0b32, Pooyan) — attract sub-state 6 handler: verify the
 * 0x82bc integrity block (any mismatch re-enters resetToAttractScreenStart), run the frame-animation + sprite rebuild
 * (advanceAttractAnimationAndRepaint / advanceFourObjectAnimsAndRebuildList), then the 0x8e50 script timer; on expiry seat the next script pointer via
 * fetchWordFromTableIndex and, on a checksum frame, run the 14x29 column checksum over 0x8462 and verify it against
 * the two bytes at the INTRO_DELAY_CKSUM_WORD pointer — low miss -> resetToAttractScreenStart, high miss -> blankRowThenFloodColorsAndAdvanceAttract,
 * clean pass -> set main state 3 + resetActorStateForBoard. Every call is dissolved to an idiomatic
 * sibling; the oracle drives the frozen ones.
 *
 * advanceAttractSequenceToPlay is a void attract handler — no register survives — so equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack. Each decision path is crafted: row mismatch, timer running
 * (early return), a checksum-frame clean pass, and a checksum-frame high-byte miss.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == advanceAttractSequenceToPlay in RAM (−stack).
 *   2. WRITE-SET — the running-timer path ticks the frame-animation + script timers.
 *   3. TEETH — a corrupted post-run byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0b32.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0b32 as oracle } from "../../translated/loc_0b32.js";
import { advanceAttractSequenceToPlay } from "../advanceAttractSequenceToPlay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  HUD_INTEGRITY_STRIP_A,
  ANIM_FRAME_COUNTER,
  SCRIPT_FRAME_TIMER,
  SCRIPT_COL_CHECK_TICK,
  INTRO_DELAY_CKSUM_WORD,
  ROUND_TILE_DST,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROW_STRIDE = 0x20;
const PAIR_COUNT = 0x0a;
const CKSUM_SPAN = 0x1c0; //     bytes scanned by the 14x29 column checksum from 0x8462
const VERIFY_ADDR = 0x8700; //   RAM the check word points at (holds the expected sum bytes)
const SP0 = 0x8fe0; //           inside STACK_SCRATCH
const CALLER_RET = 0xfffc; //    the tail-exit ret pops this dead-stack word

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/**
 * Seat a clone. By default the integrity block is uniform (rows equal) and the checksum region is
 * zeroed. opts override the timers + the two expected checksum bytes at VERIFY_ADDR.
 */
function seat(m, { animCtr = 2, frameTimer = 5, checkTick = 1, rowMismatch = false, expLo = 0, expHi = 0 } = {}) {
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  // integrity block: 11 cells 0x20 apart, all equal -> passes the pair check
  for (let i = 0; i <= PAIR_COUNT; i++) m.mem8[HUD_INTEGRITY_STRIP_A - i * ROW_STRIDE] = 0x00;
  if (rowMismatch) m.mem8[HUD_INTEGRITY_STRIP_A] = 0xff; // top cell differs from the row below
  for (let i = 0; i < CKSUM_SPAN; i++) m.mem8[ROUND_TILE_DST + i] = 0x00; // zeroed -> sum 0, carries 0
  m.mem8[ANIM_FRAME_COUNTER] = animCtr;
  m.mem8[SCRIPT_FRAME_TIMER] = frameTimer;
  m.mem8[SCRIPT_COL_CHECK_TICK] = checkTick;
  m.mem16[INTRO_DELAY_CKSUM_WORD] = VERIFY_ADDR; // check word points at the expected sum bytes
  m.mem8[VERIFY_ADDR] = expLo;
  m.mem8[VERIFY_ADDR + 1] = expHi;
  m.mem16[0x880b] = 0x8400; // blankRowThenFloodColorsAndAdvanceAttract->blankFillRowAndStepCounter fills B tiles at this pointer; seat valid VRAM so the anti-tamper high-miss arm does not fill ROM (mirrors the live attract state)
  return m;
}

const CASES = {
  "row mismatch -> resetToAttractScreenStart": (m) => seat(m, { rowMismatch: true }),
  "timer running -> early return": (m) => seat(m, { frameTimer: 5 }),
  "checksum frame -> clean pass": (m) => seat(m, { frameTimer: 1, checkTick: 1, expLo: 0, expHi: 0 }),
  "checksum frame -> high-byte miss (blankRowThenFloodColorsAndAdvanceAttract)": (m) => seat(m, { frameTimer: 1, checkTick: 1, expLo: 0, expHi: 1 }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every crafted path — advanceAttractSequenceToPlay == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceAttractSequenceToPlay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the running-timer path ticks the frame-animation + script timers", () => {
  const o = CASES["timer running -> early return"](BASE.clone());
  oracle(o);
  assert.equal(o.mem8[ANIM_FRAME_COUNTER], 0x01, "frame-animation counter decremented 2 -> 1");
  assert.equal(o.mem8[SCRIPT_FRAME_TIMER], 0x04, "script timer decremented 5 -> 4");
  console.log("  WRITE-SET: frame-animation + script timers ticked");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["timer running -> early return"](BASE.clone());
  const c = CASES["timer running -> early return"](BASE.clone());
  oracle(o);
  advanceAttractSequenceToPlay(c);
  c.mem8[SCRIPT_FRAME_TIMER] = (o.mem8[SCRIPT_FRAME_TIMER] ^ 0xff) & 0xff; // BUG: wrong timer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte — it is worthless");
  assert.equal(d.addr, SCRIPT_FRAME_TIMER, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: corrupted byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
