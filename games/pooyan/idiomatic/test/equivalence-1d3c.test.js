// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for resetGameToAttractState (ROM 0x1d3c, Pooyan) — cold-teardown tail of the play-state
 * dispatch handler.
 *
 * SEATING: BALANCED — the routine zeroes the in-play state block, seeds the fresh-start flags,
 * dissolves zeroSpriteListAndActorArena (a verified idiomatic module) to zero the board RAM, KEEPS m.call(0x0ecf)
 * (sound command 0, unlifted) with its push16 return slot, and unpacks the 0x1e4c ROM table
 * (each byte >> 1) into the display-message buffer to the 0x7f terminator. LIVE-OUT is memory
 * only, so the comparison is RAM (dumpState) minus stack scratch below the entry SP; the register file is not compared.
 *
 * The two sides differ in transient stack use (the oracle m.call's frozen zeroSpriteListAndActorArena with a push16;
 * the module calls idiomatic zeroSpriteListAndActorArena directly) — masked because SP ends where it started and all
 * push residue lands inside STACK_SCRATCH.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) after a full run.
 *   2. WRITE-SET — the fresh-start flags and the first unpacked message byte land as specified.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that never ran diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1d3c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d3c as oracle } from "../../translated/loc_1d3c.js";
import { resetGameToAttractState } from "../resetGameToAttractState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  MAIN_GAME_STATE,
  GAME_ACTIVE_FLAG,
  FLIP_SCREEN_FLAG,
  LAUNCH_ARMED_FLAG,
  DISPLAY_MSG_BUF,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0; // inside STACK_SCRATCH; kept/dissolved calls stay below it, in scratch
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with SP seated inside STACK_SCRATCH; the state block is pre-dirtied so a clear shows. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (const addr of [GAME_ACTIVE_FLAG, MAIN_GAME_STATE, FLIP_SCREEN_FLAG, LAUNCH_ARMED_FLAG]) m.mem8[addr] = 0x55;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: resetGameToAttractState == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  resetGameToAttractState(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL: full teardown identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: fresh-start flags seeded; first message byte unpacked (>>1)", () => {
  const c = craft();
  resetGameToAttractState(c);
  assert.equal(c.mem8[GAME_ACTIVE_FLAG], 0, "game-active zeroed");
  assert.equal(c.mem8[MAIN_GAME_STATE], 1, "main state = 1");
  assert.equal(c.mem8[FLIP_SCREEN_FLAG], 1, "flip-screen = 1");
  assert.equal(c.mem8[LAUNCH_ARMED_FLAG], 1, "launch-armed = 1");
  assert.equal(c.mem8[DISPLAY_MSG_BUF], ROM[0x1e4c] >> 1, "first msg byte = table[0] >> 1");
  console.log("  WRITE-SET: flags + first unpacked byte");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  resetGameToAttractState(c);
  c.mem8[DISPLAY_MSG_BUF] = (c.mem8[DISPLAY_MSG_BUF] ^ 0xff) & 0xff; // BUG: wrong unpacked byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte — it is worthless");
  assert.equal(d.addr, DISPLAY_MSG_BUF, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that never ran the teardown diverges from the oracle", () => {
  const o = craft();
  const c = craft(); // twin: do nothing -> the pre-dirtied 0x55 flags survive
  oracle(o);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped teardown must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
