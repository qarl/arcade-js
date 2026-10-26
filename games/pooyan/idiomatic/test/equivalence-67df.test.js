// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for reinitRoundArenaAndPlayfieldIfImageIntact (ROM 0x67df) — "screen re-init behind a colour-map
 * checksum": sum ten colour-map cells at 0x82bc (stride -0x20) into an 8-bit accumulator; if the
 * sum != 0x5a, tail to 0x67a0 (the per-object frame updater) and return. On a match: set
 * 0x8904/0x8808/0x880a=1, clear 9 bytes at 0x8928 (rst 0x10), zero the 0x8a80..0x8cc0 arena (ld
 * (hl),0 + ldir), then paint 0x1d rows of 0x1d tiles of 0x10 from 0x8442 (+0x20 per row).
 *
 * Cycle-free memory-equivalence gate (docs/decompiler-pipeline): a FRESH clone per side, compared
 * on RAM (dumpState, minus stack scratch below the entry SP). pc/SP/cycles are NOT compared. reinitRoundArenaAndPlayfieldIfImageIntact is reached by
 * tail transfer from the ROM integrity guards and its exit registers are init scratch no caller
 * consumes — the contract is RAM only. The oracle's rst-0x10 `push16`s land in STACK_SCRATCH, which
 * the idiomatic direct calls skip — excluded by contract.
 *
 * Both branches are CRAFTED (the leaf runs only from a tamper-abort, not attract/play): the ten
 * checksum cells are poked to sum to 0x5a (match) or not (mismatch). On the mismatch case the
 * shared frame-delay timer (0x8929) is seated non-zero so the frame updater takes its
 * decrement-and-return path, giving a single well-defined write on both sides.
 *
 * Jobs:
 *   1. EQUAL — the MATCH re-init and the MISMATCH tail both give reinitRoundArenaAndPlayfieldIfImageIntact == oracle in RAM (-stack).
 *   2. WRITE-SET — the match path seats the three state flags to 1, clears the timer block and the
 *      arena, and paints the playfield square (0x1d x 0x1d of tile 0x10, row stride 0x20).
 *   3. TEETH — a twin with a wrong painted tile is CAUGHT in the paint region; a twin with a wrong
 *      state flag is CAUGHT at 0x8904.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-67df.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_67df as oracle } from "../../translated/loc_67df.js";
import { reinitRoundArenaAndPlayfieldIfImageIntact } from "../reinitRoundArenaAndPlayfieldIfImageIntact.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ROUND_IN_PROGRESS, PHASE_TIMER, PLAY_STATE_INDEX, ACTOR_TABLE, SHARED_FRAME_DELAY_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

// New-name addresses (pending merge into names.js); tests are exempt from the address/gate rules.
const CKSUM_BASE = 0x82bc; //     bottom cell of the 10-cell colour-map checksum column
const CKSUM_COUNT = 0x0a; //      cells summed
const ROW_STRIDE = 0x20; //       one tilemap row
const CKSUM_EXPECTED = 0x5a; //   clean-image sum sentinel
const TIMER_BLOCK_BASE = 0x8928; // base of the 9-byte per-frame timer block cleared
const TIMER_BLOCK_LEN = 0x09;
const ARENA_END = 0x8cc0; //      last arena byte cleared (0x8a80 + 0x240)
const PAINT_START = 0x8442; //    first painted playfield cell
const PAINT_TILE = 0x10; //       the blank tile painted
const PAINT_SPAN = 0x1d; //       tiles per row and rows

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Poke the ten checksum cells so they sum to `sum` (first cell = sum, the rest 0). */
function seatChecksum(m, sum) {
  let cell = CKSUM_BASE;
  for (let i = 0; i < CKSUM_COUNT; i++) {
    m.mem.write8(cell, i === 0 ? sum & 0xff : 0);
    cell = (cell - ROW_STRIDE) & 0xffff;
  }
}

/** MATCH clone: checksum sums to 0x5a. */
function craftMatch() {
  const m = BASE.clone();
  seatChecksum(m, CKSUM_EXPECTED);
  // Pre-dirty the timer block (0x8928..0x8930) and the actor arena (0x8a80..0x8cc0) so the module's
  // clears register as real diffs — a fresh clone is all-zero there, making a dropped wipe invisible.
  for (let a = 0x8928; a <= 0x8930; a++) m.mem.write8(a, 0xaa);
  for (let a = 0x8a80; a < 0x8cc0; a++) m.mem.write8(a, 0xaa);
  m.regs.sp = 0x8ffe;
  return m;
}

/** MISMATCH clone: checksum != 0x5a; the frame-delay timer non-zero so the tail just decrements. */
function craftMismatch() {
  const m = BASE.clone();
  seatChecksum(m, 0x00); // sum 0 != 0x5a
  m.mem.write8(SHARED_FRAME_DELAY_TIMER, 0x05);
  m.regs.ix = ACTOR_TABLE;
  m.regs.sp = 0x8ffe;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: MATCH re-init — reinitRoundArenaAndPlayfieldIfImageIntact == oracle in RAM (−stack)", () => {
  const o = craftMatch();
  const c = craftMatch();
  oracle(o);
  reinitRoundArenaAndPlayfieldIfImageIntact(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL(match): re-init identical (flags + timer block + arena + playfield paint)");
});

test("EQUAL: MISMATCH tail — reinitRoundArenaAndPlayfieldIfImageIntact == oracle in RAM (−stack)", () => {
  const o = craftMismatch();
  const c = craftMismatch();
  oracle(o);
  reinitRoundArenaAndPlayfieldIfImageIntact(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  assert.equal(c.mem.read8(SHARED_FRAME_DELAY_TIMER), 0x04, "the tail decremented the frame-delay timer 5 -> 4");
  console.log("  EQUAL(mismatch): tail to the frame updater identical (single timer decrement)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: match path seats the flags, clears the timer block + arena, paints the playfield", () => {
  const m = craftMatch();
  // Pre-dirty representative cells so each documented write is a visible change.
  m.mem.write8(ROUND_IN_PROGRESS, 0x00);
  m.mem.write8(PHASE_TIMER, 0x00);
  m.mem.write8(PLAY_STATE_INDEX, 0x00);
  m.mem.write8(TIMER_BLOCK_BASE, 0xaa);
  m.mem.write8((TIMER_BLOCK_BASE + TIMER_BLOCK_LEN - 1) & 0xffff, 0xaa);
  m.mem.write8(ACTOR_TABLE, 0xaa);
  m.mem.write8(ARENA_END, 0xaa);
  m.mem.write8(PAINT_START, 0x00);
  m.mem.write8((PAINT_START + PAINT_SPAN - 1) & 0xffff, 0x00); // row-0 last painted cell
  m.mem.write8((PAINT_START + ROW_STRIDE) & 0xffff, 0x00); // row-1 first painted cell

  oracle(m);

  assert.equal(m.mem.read8(ROUND_IN_PROGRESS), 0x01, "round-in-progress flag := 1");
  assert.equal(m.mem.read8(PHASE_TIMER), 0x01, "phase timer := 1");
  assert.equal(m.mem.read8(PLAY_STATE_INDEX), 0x01, "play sub-state := 1");
  assert.equal(m.mem.read8(TIMER_BLOCK_BASE), 0x00, "timer block start cleared");
  assert.equal(m.mem.read8((TIMER_BLOCK_BASE + TIMER_BLOCK_LEN - 1) & 0xffff), 0x00, "timer block end cleared");
  assert.equal(m.mem.read8(ACTOR_TABLE), 0x00, "arena start cleared");
  assert.equal(m.mem.read8(ARENA_END), 0x00, "arena end (0x8cc0) cleared");
  assert.equal(m.mem.read8(PAINT_START), PAINT_TILE, "playfield paint start := 0x10");
  assert.equal(m.mem.read8((PAINT_START + PAINT_SPAN - 1) & 0xffff), PAINT_TILE, "row-0 last painted cell := 0x10");
  assert.equal(m.mem.read8((PAINT_START + ROW_STRIDE) & 0xffff), PAINT_TILE, "row-1 first painted cell := 0x10 (stride 0x20)");
  console.log("  WRITE-SET: 3 flags:=1, timer block + arena cleared, playfield square painted (stride 0x20)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong painted tile is CAUGHT in the paint region", () => {
  const o = craftMatch();
  const c = craftMatch();
  oracle(o);
  reinitRoundArenaAndPlayfieldIfImageIntact(c);
  c.mem.write8(PAINT_START, 0x00); // BUG: painted cell must be 0x10
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong painted tile — it is worthless");
  assert.equal(d.addr, PAINT_START, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(paint): wrong tile caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong state flag is CAUGHT at 0x8904", () => {
  const o = craftMatch();
  const c = craftMatch();
  oracle(o);
  reinitRoundArenaAndPlayfieldIfImageIntact(c);
  c.mem.write8(ROUND_IN_PROGRESS, 0x00); // BUG: flag must be seated to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a cleared state flag");
  assert.equal(d.addr, ROUND_IN_PROGRESS, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(flag): cleared flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
