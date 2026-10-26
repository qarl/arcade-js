// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blitTwoTileAnimFrameOnHoldTimer (ROM 0x2563) — "frame-gated two-tile animation":
 * gate on the play-mode latch 0x8f50; run a hold countdown at 0x8f06; on expiry reload the
 * hold, advance the phase 0x8f07, then (keyed on round parity 0x8907 bit0 and the phase
 * parity) pick one of four 4-byte source blocks at 0x2744 (stride 4) and one of two video
 * anchors (0x84bb / 0x87bb) and stamp two 2x2 squares three rows apart via loc_3325.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case
 * uses a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * pc/SP/cycles are NOT compared (the oracle drives them through m.step/m.push/m.ret, the
 * stack ABI the direct-call layer replaces). blitTwoTileAnimFrameOnHoldTimer has NO register live-out: its only
 * caller (dispatchPerFrameActorUpdatePasses) reads no register result, invoking the next helper (renderMarkerColumnExtendOrRetract) straight
 * after, so the contract is memory alone. The routine takes no register inputs either — it
 * loads every pointer itself — so a case is just a set of poked cells.
 *
 * The leaf is a live-gameplay animation tick (not reached in a plain attract), so all cases
 * are CRAFTED: identical cell pokes on both sides. The oracle's loc_3325 sub-calls resolve
 * through the full translated registry that new Machine(ROM) builds.
 *
 * Jobs:
 *   1. EQUAL — over the gate arm, the hold-countdown arm, and all four blit arms (round x
 *      phase parity), oracle == blitTwoTileAnimFrameOnHoldTimer in RAM (−stack).
 *   2. WRITE-SET — on a blit arm the only writes are 0x8f06, 0x8f07, and the eight cells of
 *      the two 2x2 squares.
 *   3. TEETH — a twin that writes a WRONG byte into the last blit cell MUST be caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2563.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2563 as oracle } from "../../translated/loc_2563.js";
import { blitTwoTileAnimFrameOnHoldTimer } from "../blitTwoTileAnimFrameOnHoldTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const PLAY_MODE_LATCH = 0x8f50;
const TWOTILE_ANIM_HOLD = 0x8f06;
const TWOTILE_ANIM_PHASE = 0x8f07;
const ROUND_COUNTER = 0x8907;
const VRAM_ANCHOR_EVEN = 0x84bb; // round bit0 clear
const VRAM_ANCHOR_ODD = 0x87bb; // round bit0 set
const SRC_TABLE = 0x2744; // four 4-byte source blocks, stride 4

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x9000);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh reset machine with the routine's four input cells poked identically. */
function craft({ latch, hold, phase, round }) {
  const m = BASE.clone();
  m.mem.write8(PLAY_MODE_LATCH, latch);
  m.mem.write8(TWOTILE_ANIM_HOLD, hold);
  m.mem.write8(TWOTILE_ANIM_PHASE, phase);
  m.mem.write8(ROUND_COUNTER, round);
  m.regs.sp = 0x9000; // stack top inside STACK_SCRATCH; the oracle's push/pop stay there
  return m;
}

/** The four cells one 2x2 blit writes, in blit2x2TileBlock's order. */
const blitCells = (d) => [d & 0xffff, (d + 0x01) & 0xffff, (d + 0x21) & 0xffff, (d + 0x20) & 0xffff];

/** The eight cells both squares write, given the first anchor. */
function squareCells(anchor) {
  const lowerLeft = (anchor + 0x20) & 0xffff; // blit returns anchor + one row
  const second = (lowerLeft - 0x60) & 0xffff;
  return [...blitCells(anchor), ...blitCells(second)];
}

// gate arm, hold-countdown arm, then the four blit arms (round parity x phase parity).
// phase is poked PRE-increment: init 0 -> 1 (odd), init 1 -> 2 (even).
const CASES = [
  { name: "gate busy", poke: { latch: 0x01, hold: 0x05, phase: 0x00, round: 0x00 } },
  { name: "hold decrement", poke: { latch: 0x00, hold: 0x05, phase: 0x00, round: 0x00 } },
  { name: "round0/phaseOdd", poke: { latch: 0x00, hold: 0x00, phase: 0x00, round: 0x00 } },
  { name: "round0/phaseEven", poke: { latch: 0x00, hold: 0x00, phase: 0x01, round: 0x00 } },
  { name: "round1/phaseOdd", poke: { latch: 0x00, hold: 0x00, phase: 0x00, round: 0x01 } },
  { name: "round1/phaseEven", poke: { latch: 0x00, hold: 0x00, phase: 0x01, round: 0x01 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every arm — blitTwoTileAnimFrameOnHoldTimer == oracle in RAM (−stack)", () => {
  for (const { name, poke } of CASES) {
    const o = craft(poke);
    const c = craft(poke);
    oracle(o);
    blitTwoTileAnimFrameOnHoldTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a blit arm writes only 0x8f06, 0x8f07 and the two 2x2 squares", () => {
  const poke = { latch: 0x00, hold: 0x00, phase: 0x00, round: 0x00 }; // round0/phaseOdd -> anchor 0x84bb
  const squares = squareCells(VRAM_ANCHOR_EVEN);
  const allowed = new Set([TWOTILE_ANIM_HOLD, TWOTILE_ANIM_PHASE, ...squares]);

  const before = craft(poke);
  // pre-dirty ONLY the blit target cells so their writes register as changes. HOLD/PHASE keep their
  // poked values: HOLD must stay 0 so the routine takes the expiry+blit path (reload + phase bump),
  // not the decrement branch that returns early without touching PHASE or the squares.
  for (const cell of squares) before.mem.write8(cell, 0xaa);
  const after = before.clone();
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the oracle's push/pop scratch is not game state
    changed.push(addr);
  }
  for (const addr of changed) {
    assert.ok(allowed.has(addr), `oracle wrote outside the footprint at ${hx(addr)}`);
  }
  // the two structural cells always change (reload 0x0c over 0xAA; inc 0xAA -> 0xAB).
  for (const cell of [TWOTILE_ANIM_HOLD, TWOTILE_ANIM_PHASE]) {
    assert.ok(changed.includes(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} cells, all within the ${allowed.size}-cell footprint`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong last-cell byte is CAUGHT by the RAM diff", () => {
  const poke = { latch: 0x00, hold: 0x00, phase: 0x00, round: 0x00 };
  const o = craft(poke);
  const c = craft(poke);
  oracle(o);
  blitTwoTileAnimFrameOnHoldTimer(c);
  const last = squareCells(VRAM_ANCHOR_EVEN).at(-1);
  c.mem.write8(last, (c.mem.read8(last) + 1) & 0xff); // BUG: corrupt the final blit cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong blit byte — it is worthless");
  assert.equal(d.addr, last, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(last)})`);
  console.log(`  TEETH: wrong blit byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
