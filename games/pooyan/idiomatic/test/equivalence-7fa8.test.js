// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for floodWriteAnimCellsAndLatchPhase (ROM 0x7fa8-0x7fd5) — the shared write-anim tail
 * tail-delegated into from advanceWriteAnimTileIndexOnCountdown/appendWriteAnimBlockRowOnPhase. It (1) enqueues sound command 0 (the oracle via the
 * frozen loc_0ecf, the module via its idiomatic twin queueSoundCommand00 — so this test also pins the
 * twin against the frozen helper in RAM), (2) OPTIONALLY floods `count` (0x8e25) cells with the fill
 * tile 0x10 down a pointer at 0x8e27 (stride -0x20) and up the record pointer at
 * ANIM_WORK_BLOCK_PTR (stride +1), and (3) latches PHASE_TIMER=0x80, 0x8e26=0, RESET_SCAN_LATCH=1.
 *
 * CYCLE-FREE / memory-equivalence gate: the handler WRITES RAM, so every case uses a FRESH clone per
 * side. The contract is RAM (dumpState minus stack scratch below the entry SP); this is a void terminal handler, so there
 * is no register live-out to check.
 *
 * LOAD-BEARING BRANCH = count==0 vs count!=0 (the `and a; jr z` at 0x7fae). Both arms are driven:
 *   - count!=0: the djnz fill runs; assert the flooded cells + full RAM agree, and the pointers are
 *     NOT written back (0x8e27/0x8e1f unchanged).
 *   - count==0: the fill is skipped; assert only the tail latches fire.
 * TEETH: a twin that floods a WRONG cell, or latches a WRONG tail value, MUST be caught in RAM.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7fa8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7fa8 as oracle } from "../../translated/loc_7fa8.js";
import { floodWriteAnimCellsAndLatchPhase } from "../floodWriteAnimCellsAndLatchPhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, PHASE_TIMER, ANIM_WORK_BLOCK_PTR, RESET_SCAN_LATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x7fa8;
const COUNT_CELL = 0x8e25;
const TILE_PTR_CELL = 0x8e27; // 16-bit LE pointer the fill walks back by 0x20
const CLEARED_CELL = 0x8e26; // latched to 0 by the tail
const FILL_TILE = 0x10;
const TILE_STRIDE = 0x20;

// Fill destinations chosen to stay inside diffed RAM (color 0x8000-0x83ff, video 0x8400-0x87ff),
// disjoint from each other and from the control cells / STACK_SCRATCH.
const TILE_PTR_START = 0x83e0; // walks back: 0x83e0, 0x83c0, ... (color RAM)
const REC_PTR_START = 0x8600; //  walks up:   0x8600, 0x8601, ... (video RAM)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, STACK_SCRATCH.hi - 0x10);

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/** A machine primed with the two fill pointers + a given count, dest cells pre-dirtied to 0xAA. */
function craft(count) {
  const m = new Machine(ROM);
  m.regs.sp = STACK_SCRATCH.hi - 0x10; // the oracle push16(0x7fab)s before call 0x0ecf
  // Pre-dirty the whole fill span (both directions) so a 0x10 write is visible and a wrong write differs.
  for (let i = 0; i < 0x20; i++) {
    m.mem.write8((TILE_PTR_START - i * TILE_STRIDE) & 0xffff, 0xaa);
    m.mem.write8((REC_PTR_START + i) & 0xffff, 0xaa);
  }
  m.mem.write8(COUNT_CELL, count & 0xff);
  m.mem.write16(TILE_PTR_CELL, TILE_PTR_START);
  m.mem.write16(ANIM_WORK_BLOCK_PTR, REC_PTR_START);
  return m;
}

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  try { host.runFrames(maxFrames); } catch { /* best-effort: a boot gap must not fail the gate */ }
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 6000) : [];

test("CAPTURE: real 0x7fa8 dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    floodWriteAnimCellsAndLatchPhase(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED: count != 0 (fill arm, load-bearing) --------------------------

// Max 0x1f: the pre-dirty span (and the color-RAM tile run) is 0x20 cells, so the one-past sentinel
// for a count of 0x20 would land beyond the span (in ROM). 0x1f keeps a large fill with a valid sentinel.
const NONZERO_COUNTS = [0x01, 0x04, 0x10, 0x1f];

test("CRAFTED count!=0: djnz fill floods `count` cells identically; pointers not written back", () => {
  for (const count of NONZERO_COUNTS) {
    const o = craft(count);
    const c = craft(count);
    oracle(o);
    floodWriteAnimCellsAndLatchPhase(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `count ${hx(count)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    // Every one of `count` cells got the fill tile on BOTH runs (down the tile ptr + up the record ptr).
    for (let i = 0; i < count; i++) {
      const tileCell = (TILE_PTR_START - i * TILE_STRIDE) & 0xffff;
      const recCell = (REC_PTR_START + i) & 0xffff;
      assert.equal(c.mem.read8(tileCell), FILL_TILE, `count ${hx(count)}: tile cell ${hx(tileCell)} not filled`);
      assert.equal(c.mem.read8(recCell), FILL_TILE, `count ${hx(count)}: record cell ${hx(recCell)} not filled`);
    }
    // The cell one step PAST the run must be untouched (still 0xAA) — proves the count bound.
    assert.equal(c.mem.read8((TILE_PTR_START - count * TILE_STRIDE) & 0xffff), 0xaa,
      `count ${hx(count)}: fill overran the tile run`);
    assert.equal(c.mem.read8((REC_PTR_START + count) & 0xffff), 0xaa,
      `count ${hx(count)}: fill overran the record run`);

    // Pointers are NOT written back by this handler.
    assert.equal(c.mem.read16(TILE_PTR_CELL), TILE_PTR_START, `count ${hx(count)}: tile pointer was written back`);
    assert.equal(c.mem.read16(ANIM_WORK_BLOCK_PTR), REC_PTR_START, `count ${hx(count)}: record pointer was written back`);

    // The tail latches still fire after the fill.
    assert.equal(c.mem.read8(PHASE_TIMER), 0x80, `count ${hx(count)}: PHASE_TIMER not latched`);
    assert.equal(c.mem.read8(CLEARED_CELL), 0x00, `count ${hx(count)}: 0x8e26 not cleared`);
    assert.equal(c.mem.read8(RESET_SCAN_LATCH), 0x01, `count ${hx(count)}: RESET_SCAN_LATCH not set`);
  }
  console.log(`  CRAFTED count!=0: ${NONZERO_COUNTS.length} counts flooded + latched identically`);
});

// -- 3. CRAFTED: count == 0 (skip arm) ----------------------------------------

test("CRAFTED count==0: fill skipped; only the tail latches fire", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  floodWriteAnimCellsAndLatchPhase(c);

  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

  // No fill happened — first cell of each run is still the pre-dirtied 0xAA.
  assert.equal(c.mem.read8(TILE_PTR_START), 0xaa, "count==0 still wrote the tile run");
  assert.equal(c.mem.read8(REC_PTR_START), 0xaa, "count==0 still wrote the record run");

  // Tail latches.
  assert.equal(c.mem.read8(PHASE_TIMER), 0x80, "PHASE_TIMER not latched");
  assert.equal(c.mem.read8(CLEARED_CELL), 0x00, "0x8e26 not cleared");
  assert.equal(c.mem.read8(RESET_SCAN_LATCH), 0x01, "RESET_SCAN_LATCH not set");
  console.log("  CRAFTED count==0: skip arm agrees + latches fire");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: floods one WRONG tile cell — must be caught at that destination. */
function brokenFill(m) {
  floodWriteAnimCellsAndLatchPhase(m);
  const bad = (TILE_PTR_START - 2 * TILE_STRIDE) & 0xffff;
  m.mem.write8(bad, (m.mem.read8(bad) ^ 0x01) & 0xff);
}

/** Broken twin: latches a WRONG PHASE_TIMER value — must be caught at PHASE_TIMER. */
function brokenTail(m) {
  floodWriteAnimCellsAndLatchPhase(m);
  m.mem.write8(PHASE_TIMER, 0x81); // BUG: should be 0x80
}

test("TEETH: a wrong fill cell is CAUGHT", () => {
  const o = craft(0x10);
  const c = craft(0x10);
  oracle(o);
  brokenFill(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong fill cell — it is worthless");
  assert.equal(d.addr, (TILE_PTR_START - 2 * TILE_STRIDE) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong fill caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong tail latch is CAUGHT (even on the count==0 arm)", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  brokenTail(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong tail latch — it is worthless");
  assert.equal(d.addr, PHASE_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: wrong tail latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
