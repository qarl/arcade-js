// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for renderPlayTimerNibblesAndGuardChecksum (ROM 0x7960) — the shared integrity + play-timer
 * nibble-render handler. On a valid data image the handler: enqueues one fixed display command;
 * folds a 16-bit checksum plus an even-offset running sum over a fixed code block and matches
 * four result bytes against the guards that trail it; splits the active player's timer minutes
 * and seconds BCD bytes into hi/lo nibble tiles up a video column (with a spacer tile between);
 * clears those timer bytes; and scans a small flag block, returning when it is clear.
 *
 * This is the cycle-free / memory-equivalence gate. The routine writes work RAM and video RAM,
 * so every case uses a FRESH clone per side and the two are compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * There is NO register live-out: both dispatch callers reload every register before reading one,
 * so pc/SP/cycles and the register file are all excluded — only memory is the contract.
 *
 * The leaf is not reached in a plain boot/attract, so every case is CRAFTED: the active-player
 * select, the timer BCD bytes, and the flag block are poked identically on both sides. craft()
 * zeros the flag block by default so the common path is taken; one arm sets a flag to exercise
 * the (otherwise unreached) tail check.
 *
 * Jobs:
 *   1. EQUAL — over player select and timer values, oracle == renderPlayTimerNibblesAndGuardChecksum in RAM (−stack).
 *   2. WRITE-SET — with the enqueue forced to drop, the ONLY writes are the five render cells
 *      and the three cleared timer bytes.
 *   3. CRAFTED (player 2) — the second player's timer bank is the source and clear target.
 *   4. CRAFTED (tail, craft-only) — a set flag diverts to the tail check; both sides agree
 *      (this path is not otherwise reached, so it exists only as a crafted arm).
 *   5. TEETH — a wrong render byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7960.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7960 as oracle } from "../../translated/loc_7960.js";
import { renderPlayTimerNibblesAndGuardChecksum } from "../renderPlayTimerNibblesAndGuardChecksum.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { ACTIVE_PLAYER, PLAY_TIMER_BCD_P1, PLAY_TIMER_BCD_P2, STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The nibble column: base cell, then up one row (−0x20) per following tile.
const RENDER_BASE = 0x862d;
const STRIDE = 0x20;
const RENDER = [0, 1, 2, 3, 4].map((k) => RENDER_BASE - k * STRIDE); // hi-min, lo-min, spacer, hi-sec, lo-sec
const SPACER_TILE = 0x51;
const FLAG_BASE = 0x89e7;
const TAIL_SENTINEL = 0xc9;

// Player-0 timer bank byte+1 (seconds) / byte+2 (minutes), and the 3-byte clear that starts at +1.
const P1_SEC = PLAY_TIMER_BCD_P1 + 1;
const P1_MIN = PLAY_TIMER_BCD_P1 + 2;
const P2_SEC = PLAY_TIMER_BCD_P2 + 1;
const P2_MIN = PLAY_TIMER_BCD_P2 + 2;

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

/** First RAM difference minus the stack scratch below the entry SP (neither side writes it here). */
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the handler's memory inputs seated; flag block zeroed for the common path. */
function craft(opts = {}) {
  const { activePlayer = 0, sec, min, p2sec, p2min, dropEnqueue = false, setFlag } = opts;
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // in work RAM; the oracle's pushes/rets land only in the dead stack window
  m.mem.write8(ACTIVE_PLAYER, activePlayer);
  for (let i = 0; i < 7; i++) m.mem.write8(FLAG_BASE + i, 0); // clear -> common (no-divert) path
  if (sec !== undefined) m.mem.write8(P1_SEC, sec);
  if (min !== undefined) m.mem.write8(P1_MIN, min);
  if (p2sec !== undefined) m.mem.write8(P2_SEC, p2sec);
  if (p2min !== undefined) m.mem.write8(P2_MIN, p2min);
  if (dropEnqueue) {
    m.mem.write8(0x88a0, 0xc0); // point the display-ring write pointer at a slot we mark occupied
    m.mem.write8(0x88c0, 0x00); // bit7 clear -> occupied -> the enqueue drops (no ring writes)
  }
  if (setFlag) for (const [addr, v] of setFlag) m.mem.write8(addr, v);
  return m;
}

const CASES = [
  { activePlayer: 0 }, //                                   P1, timers as booted
  { activePlayer: 0, sec: 0x37, min: 0x59 }, //             P1, nonzero BCD
  { activePlayer: 0, sec: 0x00, min: 0x00 }, //             P1, zero BCD
  { activePlayer: 1 }, //                                   P2, timers as booted
  { activePlayer: 1, p2sec: 0x08, p2min: 0x42 }, //         P2, nonzero BCD
  { activePlayer: 5, p2sec: 0x99, p2min: 0x10 }, //         any nonzero select -> P2 bank
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted player/timer — renderPlayTimerNibblesAndGuardChecksum == oracle in RAM (−stack)", () => {
  for (const c0 of CASES) {
    const o = craft(c0);
    const c = craft(c0);
    oracle(o);
    renderPlayTimerNibblesAndGuardChecksum(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b} (${JSON.stringify(c0)})`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: with the enqueue dropped, only the 5 render cells and 3 cleared timer bytes change", () => {
  const o = craft({ activePlayer: 0, sec: 0x37, min: 0x59, dropEnqueue: true });
  // The clear runs 3 bytes from the seconds cell: P1_SEC, P1_MIN, then the next bank byte. That
  // third byte may already be 0 in a booted clone; poke it nonzero so the clear shows as a change.
  o.mem.write8(PLAY_TIMER_BCD_P2, 0x11); // 0x8a33 = the third cleared byte
  for (const cell of RENDER) o.mem.write8(cell, 0xaa); // pre-dirty so every render write is a change
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();

  const changed = new Map();
  for (let off = 0; off < before.length; off++) {
    if (before[off] === after[off]) continue;
    const addr = o.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's rst push/ret framing lands in the dead stack
    changed.set(addr, after[off]);
  }
  const clearCells = [P1_SEC, P1_MIN, PLAY_TIMER_BCD_P2]; // 0x8a31/0x8a32/0x8a33, low->high
  const expect = new Map([
    [RENDER[0], (0x59 & 0xf0) >> 4], // hi minutes = 5
    [RENDER[1], 0x59 & 0x0f], //       lo minutes = 9
    [RENDER[2], SPACER_TILE], //       spacer
    [RENDER[3], (0x37 & 0xf0) >> 4], // hi seconds = 3
    [RENDER[4], 0x37 & 0x0f], //       lo seconds = 7
    ...clearCells.map((a) => [a, 0]),
  ]);
  assert.equal(changed.size, expect.size, `expected exactly ${expect.size} writes, got ${changed.size}`);
  for (const [addr, val] of expect) {
    assert.equal(changed.get(addr), val, `cell ${hx(addr)} expected ${val}, got ${changed.get(addr)}`);
  }
  console.log(`  WRITE-SET: 5 render cells + 3 timer clears (${expect.size} cells)`);
});

// -- 3. CRAFTED (player 2) ----------------------------------------------------

test("CRAFTED: a nonzero player select renders + clears the second player's timer bank", () => {
  const c0 = { activePlayer: 1, p2sec: 0x08, p2min: 0x42, dropEnqueue: true };
  const o = craft(c0);
  const c = craft(c0);
  o.mem.write8(P2_MIN + 1, 0x22); // 0x8a36 = the third cleared byte, made nonzero to observe the clear
  c.mem.write8(P2_MIN + 1, 0x22);
  oracle(o);
  renderPlayTimerNibblesAndGuardChecksum(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  // The render column is player-independent; the clear falls on the P2 bank (0x8a34..0x8a36).
  assert.equal(c.mem.read8(RENDER[0]), (0x42 & 0xf0) >> 4, "hi minutes tile");
  assert.equal(c.mem.read8(RENDER[4]), 0x08 & 0x0f, "lo seconds tile");
  for (const cell of [P2_SEC, P2_MIN, P2_MIN + 1]) {
    assert.equal(c.mem.read8(cell), 0, `P2 timer byte ${hx(cell)} cleared`);
  }
  console.log("  CRAFTED/P2: render column + P2 timer bank cleared");
});

// -- 4. CRAFTED (tail, craft-only) --------------------------------------------

test("CRAFTED (tail, craft-only): a set flag diverts to the tail check; both sides agree", () => {
  // This tail is not reached with an intact flag block, so it is exercisable only by crafting a set
  // flag. Place the sentinel right after so the tail sum is short and deterministic; whatever branch
  // the verify takes (trip, gauge-repaint, or plain return), the two sides must take the SAME one.
  const seed = { activePlayer: 0, sec: 0x34, min: 0x12, setFlag: [[FLAG_BASE, 0x01], [FLAG_BASE + 1, TAIL_SENTINEL]] };
  const o = craft(seed);
  const c = craft(seed);
  let oThrew = false, cThrew = false;
  try { oracle(o); } catch { oThrew = true; }
  try { renderPlayTimerNibblesAndGuardChecksum(c); } catch { cThrew = true; }
  assert.equal(cThrew, oThrew, "module and oracle must take the same tail branch (both trip, or neither)");
  const d = ramDiffMinusStack(o, c); // the writes made before any trip must match either way
  assert.equal(d, null, d && `tail RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mod=${d.b}`);
  console.log(`  CRAFTED/tail: divert taken; both ${oThrew ? "tripped" : "completed"} with identical RAM`);
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: a wrong render byte is CAUGHT by the RAM diff", () => {
  const c0 = { activePlayer: 0, sec: 0x37, min: 0x59 };
  const o = craft(c0);
  const c = craft(c0);
  oracle(o);
  renderPlayTimerNibblesAndGuardChecksum(c);
  c.mem.write8(RENDER[0], 0x00); // BUG: the hi-minutes tile must be 5, not 0

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong render byte — it is worthless");
  assert.equal(d.addr, RENDER[0], `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(RENDER[0])})`);
  console.log(`  TEETH/RAM: wrong render byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
