// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceRopeExtendAnimation (ROM 0x2dbc, Pooyan) — the rope-extend blit driver
 * (ROPE_EXTEND_STATE == 1). It counts the hold timer, and on expiry either advances the blit
 * sequence (look up this frame's tile block, blit at the rope column, bump the frame index) or,
 * once the index reaches 8, resets the sequence and re-arms the next rope cell.
 *
 * The module dissolves the tile lookup (fetchWordFromTableIndex) and the 2x2 blit (blit2x2TileBlock) to direct
 * calls; the oracle drives the same frozen helpers via the registry new Machine(ROM) builds.
 * advanceRopeExtendAnimation is a void handler — no register survives — so equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack.
 *
 * Jobs:
 *   1. EQUAL — timer-running, blit, and reset arms: oracle == advanceRopeExtendAnimation in RAM (−stack).
 *   2. WRITE-SET — the blit arm bumps the frame index; the reset arm zeroes the index + state.
 *   3. TEETH — a wrong blitted VRAM tile is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2dbc.test.js
 */
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2dbc as oracle } from "../../translated/loc_2dbc.js";
import { advanceRopeExtendAnimation } from "../advanceRopeExtendAnimation.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const HOLD = 0x8f16; //   ROPE_EXTEND_TIMER
const FRAME = 0x8f1b; //  ROPE_EXTEND_FRAME_INDEX
const STATE = 0x8f14; //  ROPE_EXTEND_STATE
const INDEX = 0x8f18; //  ROPE_EXTEND_INDEX
const COLPTR = 0x8f19; // ROPE_COLUMN_VRAM_PTR (16-bit)
const REARM = 0x8f1d; //  re-arm cell = 0x8f00 | ((0x1b + index 2) & 0xff)
const VRAM = 0x8500; //   a writable tile-RAM blit target
const SP0 = 0x8ff0; //    inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craftRunning() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[HOLD] = 0x05; // hold timer running -> dec + ret
  return m;
}
function craftBlit() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[HOLD] = 0x00; //  expired
  m.mem8[FRAME] = 0x03; // not yet 8 -> blit path
  m.mem.write16(COLPTR, VRAM); // blit at writable tile RAM
  return m;
}
function craftReset() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[HOLD] = 0x00; //  expired
  m.mem8[FRAME] = 0x08; // reached 8 -> reset + re-arm
  m.mem8[INDEX] = 0x02; // re-arm cell = 0x8f1d
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------
test("EQUAL: running + blit + reset arms — advanceRopeExtendAnimation == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["running", craftRunning], ["blit", craftBlit], ["reset", craftReset]]) {
    const o = craft(); oracle(o);
    const c = craft(); advanceRopeExtendAnimation(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: running + blit + reset identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------
test("WRITE-SET: blit bumps the frame index; reset zeroes the index and state", () => {
  const blit = craftBlit(); oracle(blit);
  assert.equal(blit.mem8[FRAME], 0x04, "blit arm bumps the frame index 3 -> 4");

  const reset = craftReset(); oracle(reset);
  assert.equal(reset.mem8[FRAME], 0x00, "reset arm zeroes the frame index");
  assert.equal(reset.mem8[STATE], 0x00, "reset arm clears ROPE_EXTEND_STATE");
  assert.equal(reset.mem8[REARM], 0x01, "reset arm re-arms the next rope cell");
  console.log("  WRITE-SET: blit advances the sequence, reset restarts it");
});

// -- 3. TEETH -----------------------------------------------------------------
test("TEETH: a wrong blitted VRAM tile is CAUGHT by the RAM diff", () => {
  const o = craftBlit(); const c = craftBlit();
  oracle(o); advanceRopeExtendAnimation(c);
  c.mem8[VRAM] = (c.mem8[VRAM] + 1) & 0xff; // corrupt one blitted tile
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blitted tile — it is worthless");
  assert.equal(d.addr, VRAM, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
