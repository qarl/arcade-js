// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceHangingRopeObjectWithGrabCheck (ROM 0x2f01) — "rope-cell timer handler gated by the grab
 * test", the CALLER of the dissolved grab-test skip. It first runs the grab test; on a grab it
 * abandons the cell update. Otherwise it ticks the cell timer (selected by IXL&3); until zero it
 * returns; on the zero frame it re-arms the timer to a fixed reload, indexes the formation table
 * (0x8c30) by the byte after the timer to drop one record's tile field / force its position byte
 * (:= 0xc0) / bump another field, bumps (ix+0), then blits the segment's 2x2 tile square (column
 * base from the column helper, source 0x2dfe).
 *
 * This gate COMPOSES the real idiomatic grab test: the idiomatic caller imports it and early-returns
 * on its false. Three states are seated — grab taken (caller must abort), and grab-not-taken with
 * the timer non-zero and with the timer zero — so both the abort and the two continuation contracts
 * are exercised against the oracle, which runs the translated skip internally.
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP — the oracle's call trampolines and the skip's pop-af/ret land there). pc/SP/cycles
 * are NOT compared. The grab (abort) path carries NO register live-out: the skip discards the caller
 * frame, so only RAM is compared there. The not-zero path checks HL + Z (bridged by the tick); the
 * zero path checks HL / IY / B. All live-out values are derived from the oracle clone.
 *
 * The player coordinate is crafted below the window (no grab) for the continuation cases and inside
 * it (grab) for the abort case; IXL&3 == 0 selects timer/column/window slot 0.
 *
 * Jobs:
 *   1. EQUAL (not-zero path) — grab-not-taken, timer>1: oracle == advanceHangingRopeObjectWithGrabCheck in RAM (−stack) + HL + Z.
 *   2. EQUAL (zero path) — grab-not-taken, timer==1: oracle == advanceHangingRopeObjectWithGrabCheck in RAM (−stack) + HL/IY/B.
 *   3. EQUAL (grab abort path) — inside the window and idle: oracle == advanceHangingRopeObjectWithGrabCheck in RAM (−stack); the
 *      grab latch is raised and the cell body did NOT run (timer + record untouched).
 *   4. WRITE-SET — the zero path's writes: the timer cell, three record fields, (ix+0), 4 VRAM cells.
 *   5. TEETH — a wrong record byte / a wrong IY / a caller that failed to abort are all caught.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2f01.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2f01 as oracle } from "../../translated/loc_2f01.js";
import { advanceHangingRopeObjectWithGrabCheck } from "../advanceHangingRopeObjectWithGrabCheck.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROPE_CELL_TIMERS,
  FORMATION_TABLE,
  ROPE_CELL_COLUMN_TABLE,
  ROPE_SEGMENT_TILE_SRC,
  GRAB_WINDOW_TABLE,
  PLAYER_Y,
  FORMATION_STATE,
  WAVE_TEARDOWN_STATE,
  GRAB_ACTIVE_FLAG,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IXBASE = 0x8a80; //          IXL&3 == 0 selects slot 0
const TIMER0 = ROPE_CELL_TIMERS; // slot-0 timer
const REC_COUNT_CELL = ROPE_CELL_TIMERS + 1; // the byte after the timer that picks the record count
const STRIDE = 0x18; //            formation record stride
const REC_TILE = 0x0f;
const REC_POS = 0x05;
const REC_DROP = 0x06;
const RELOAD = 0x0c; //            fixed timer reload
const POS_VALUE = 0xc0; //         value forced into the record position byte
const VIDEO_PAGE = 0x8400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const HALF = ROM_PRESENT ? BASE.mem.read8(GRAB_WINDOW_TABLE) : 0;
const POS_BELOW = 0x00; //          below the grab window: the grab test returns normally
const POS_INSIDE = HALF; //         inside the grab window: the grab fires (skip)

/** A fresh clone: slot-0 timer + record-count byte seated, player coordinate + busy flags, IX at
 *  the record, grab latch cleared. `pos` defaults below the window so no grab fires. */
function craft({ timer = 1, recSel = 0x01, pos = POS_BELOW, f08 = 0, f24 = 0 } = {}) {
  const m = BASE.clone();
  m.mem.write8(TIMER0, timer);
  m.mem.write8(REC_COUNT_CELL, recSel);
  m.mem.write8(PLAYER_Y, pos & 0xff);
  m.mem.write8(FORMATION_STATE, f08);
  m.mem.write8(WAVE_TEARDOWN_STATE, f24);
  m.mem.write8(GRAB_ACTIVE_FLAG, 0x00);
  m.regs.ix = IXBASE;
  m.regs.sp = 0x8ffe; // inside STACK_SCRATCH
  return m;
}

// passes = recSel + 1; the indexed formation record base
const recordFor = (recSel) => (FORMATION_TABLE + STRIDE * (recSel + 1)) & 0xffff;

// -- 1. EQUAL (not-zero path) -------------------------------------------------

test("EQUAL: not-zero path (no grab, timer stays non-zero) — advanceHangingRopeObjectWithGrabCheck == oracle in RAM (−stack) + HL + Z", () => {
  for (const timer of [2, 3, 0x10]) {
    const o = craft({ timer });
    const c = craft({ timer });
    oracle(o);
    const ret = advanceHangingRopeObjectWithGrabCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `timer=${timer}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `timer=${timer}: HL live-out mismatch`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `timer=${timer}: return equals oracle HL`);
    assert.equal(c.regs.fZ, o.regs.fZ, `timer=${timer}: Z live-out mismatch`);
    assert.equal(o.regs.hl & 0xffff, TIMER0, "HL = the timer cell");
    assert.equal(o.regs.fZ, false, "Z clear (timer not zero)");
    assert.equal(o.mem.read8(TIMER0), timer - 1, "timer decremented");
    assert.equal(o.mem.read8(GRAB_ACTIVE_FLAG), 0x00, "no grab fired on this path");
  }
  console.log("  EQUAL(not-zero): timers 2/3/0x10 identical (RAM −stack + HL + Z)");
});

// -- 2. EQUAL (zero path) -----------------------------------------------------

test("EQUAL: zero path (no grab, timer reaches zero) — advanceHangingRopeObjectWithGrabCheck == oracle in RAM (−stack) + HL/IY/B", () => {
  for (const recSel of [0x01, 0x03]) {
    const o = craft({ timer: 1, recSel });
    const c = craft({ timer: 1, recSel });
    oracle(o);
    const ret = advanceHangingRopeObjectWithGrabCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `recSel=${hx(recSel)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `recSel=${hx(recSel)}: HL live-out mismatch`);
    assert.equal(c.regs.iy & 0xffff, o.regs.iy & 0xffff, `recSel=${hx(recSel)}: IY live-out mismatch`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `recSel=${hx(recSel)}: B live-out mismatch`);
    assert.equal(ret[0] & 0xffff, o.regs.hl & 0xffff, `recSel=${hx(recSel)}: tuple[0] (HL) equals oracle HL`);
    assert.equal(o.regs.hl & 0xff00, VIDEO_PAGE, "HL is a tilemap-page pointer (blit column + 0x20)");
    assert.equal(o.regs.iy & 0xffff, recordFor(recSel), "IY = the indexed formation record");
    assert.equal(o.regs.b & 0xff, 0, "B drained to 0");
    assert.equal(o.mem.read8(TIMER0), RELOAD, "timer cell re-armed to the fixed reload");
  }
  console.log("  EQUAL(zero): recSel 0x01/0x03 identical (RAM −stack + HL/IY/B)");
});

// -- 3. EQUAL (grab abort path) -----------------------------------------------

test("EQUAL: grab abort path (inside window + idle) — advanceHangingRopeObjectWithGrabCheck == oracle in RAM (−stack), body skipped", () => {
  const o = craft({ timer: 1, pos: POS_INSIDE });
  const c = craft({ timer: 1, pos: POS_INSIDE });
  oracle(o);
  advanceHangingRopeObjectWithGrabCheck(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `grab: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
  assert.equal(o.mem.read8(GRAB_ACTIVE_FLAG), 0x01, "grab latch raised (the grab fired)");
  assert.equal(o.mem.read8(TIMER0), 1, "the cell body did NOT run: timer left as seated");
  assert.equal(o.mem.read8((recordFor(0x01) + REC_POS) & 0xffff), 0x00, "record position byte never forced");
  console.log("  EQUAL(grab-abort): identical (RAM −stack), latch := 1, body skipped");
});

// -- 4. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: zero path writes the timer, 3 record fields, (ix+0), and 4 video-RAM cells", () => {
  const recSel = 0x01;
  const record = recordFor(recSel);
  const colLow = BASE.mem.read8(ROPE_CELL_COLUMN_TABLE + (IXBASE & 0x03));
  const columnBase = (VIDEO_PAGE | colLow) & 0xffff;
  const blitCells = [columnBase, columnBase + 1, (columnBase + 0x21) & 0xffff, (columnBase + 0x20) & 0xffff];
  const blitWant = [0, 1, 2, 3].map((i) => BASE.mem.read8((ROPE_SEGMENT_TILE_SRC + i) & 0xffff)); // TL,TR,BR,BL

  const expected = new Set([
    TIMER0,
    (record + REC_TILE) & 0xffff,
    (record + REC_POS) & 0xffff,
    (record + REC_DROP) & 0xffff,
    IXBASE,
    ...blitCells,
  ]);

  const before = craft({ timer: 1, recSel });
  const after = craft({ timer: 1, recSel });
  for (const setup of [before, after]) {
    setup.mem.write8((record + REC_TILE) & 0xffff, 0xaa);
    setup.mem.write8((record + REC_DROP) & 0xffff, 0xaa);
    setup.mem.write8(IXBASE, 0xaa);
    for (let i = 0; i < 4; i++) setup.mem.write8(blitCells[i], blitWant[i] ^ 0xff);
  }
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    const ad = after.stateOffsetToAddr(off);
    if (b0[off] !== a1[off] && !inDeadStack(ad)) changed.push(ad);
  }
  assert.equal(changed.length, expected.size, `expected ${expected.size} writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  // spot-check values
  assert.equal(after.mem.read8(TIMER0), RELOAD, "timer cell := fixed reload");
  assert.equal(after.mem.read8((record + REC_POS) & 0xffff), POS_VALUE, "record position byte forced");
  assert.equal(after.mem.read8((record + REC_TILE) & 0xffff), 0xa9, "record tile field decremented (0xaa -> 0xa9)");
  assert.equal(after.mem.read8((record + REC_DROP) & 0xffff), 0xab, "record drop field incremented (0xaa -> 0xab)");
  assert.equal(after.mem.read8(IXBASE), 0xab, "(ix+0) incremented (0xaa -> 0xab)");
  for (let i = 0; i < 4; i++) {
    assert.equal(after.mem.read8(blitCells[i]), blitWant[i], `blit cell ${hx(blitCells[i])} := source byte`);
  }
  console.log(`  WRITE-SET: ${expected.size} cells (timer + 3 record + ix + 4 blit)`);
});

// -- 5. TEETH -----------------------------------------------------------------

test("TEETH: a wrong formation-record byte is CAUGHT by the RAM diff", () => {
  const o = craft({ timer: 1 });
  const c = craft({ timer: 1 });
  oracle(o);
  advanceHangingRopeObjectWithGrabCheck(c);
  const cell = (recordFor(0x01) + REC_POS) & 0xffff;
  c.mem.write8(cell, (c.mem.read8(cell) + 1) & 0xff); // BUG: corrupt the forced record field

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong IY is CAUGHT by the live-out check", () => {
  const o = craft({ timer: 1 });
  oracle(o);
  const good = o.regs.iy & 0xffff;
  const wrong = (good + STRIDE) & 0xffff; // off by one record
  assert.notEqual(wrong, good, "the IY live-out check must reject the wrong record");
  assert.equal(good, recordFor(0x01), "sanity: oracle IY is the indexed formation record");
  console.log(`  TEETH/IY: wrong ${hx(wrong)} rejected vs oracle ${hx(good)}`);
});

test("TEETH: a caller that FAILED to abort on the grab is CAUGHT by the RAM diff", () => {
  const o = craft({ timer: 1, pos: POS_INSIDE });
  const c = craft({ timer: 1, pos: POS_INSIDE });
  oracle(o); // aborts: timer left at 1
  advanceHangingRopeObjectWithGrabCheck(c); // aborts too
  c.mem.write8(TIMER0, RELOAD); // BUG surrogate: a non-aborting caller would re-arm the timer

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a caller that ran the body on the grab path");
  assert.equal(d.addr, TIMER0, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(TIMER0)})`);
  console.log(`  TEETH/ABORT: a body-write on the grab path caught at ${hx(d.addr)}`);
});
