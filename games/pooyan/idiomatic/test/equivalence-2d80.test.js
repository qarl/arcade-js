// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for addRopeSegmentAndAdvanceExtendState (Pooyan) — "rope-extend driver, sub-state 0": add one rope
 * segment unless the rope is already at its per-stage length, gated on the segment index (below four,
 * or a pending tamper strike).
 *
 * Cycle-free memory-equivalence gate. The routine writes work RAM and uses the byte-table lookup
 * helper (which reads a fixed column table), so each case runs on a FRESH clone per side, compared on:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * There is no register live-out: it is dispatched as a per-frame state handler and rets to the state
 * loop, so pc/SP/registers are NOT compared. Every input is a work-RAM cell poked identically on both
 * sides (the routine is not reached in attract, so every case is crafted); the lookup pushes/pops in
 * the dead stack. All cases keep the tamper strike clear and the index in its normal 0..3 band.
 *
 * Jobs:
 *   1. EQUAL — at-bound early return, the extend at indices 0/2/3, and the index-past-limit bail:
 *      module == oracle in RAM (−stack).
 *   2. WRITE-SET — the index-0 extend writes exactly {segment count, index, column ptr word, this
 *      segment's cell timer, sub-state, sub-timer}; the past-limit bail writes only the segment count.
 *   3. TEETH — a corrupted column-ptr byte, and an undone sub-state advance, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2d80.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2d80 as oracle } from "../../translated/loc_2d80.js";
import { addRopeSegmentAndAdvanceExtendState } from "../addRopeSegmentAndAdvanceExtendState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  WAVE_ARRIVAL_COUNTER,
  ROPE_SEGMENT_COUNT,
  ROPE_EXTEND_INDEX,
  ROPE_EXTEND_STATE,
  ROPE_EXTEND_TIMER,
  ROPE_COLUMN_VRAM_PTR,
  ROPE_CELL_COLUMN_TABLE,
  ROPE_CELL_TIMERS,
  TAMPER_STRIKES_ROM,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const VIDEO_PAGE = 0x84;
const RELOAD = 0x10;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with all rope-machine cells seated to known, distinct-from-written values. */
function craft(arrivals, segCount, index, tamper) {
  const m = BASE.clone();
  m.mem.write8(WAVE_ARRIVAL_COUNTER, arrivals);
  m.mem.write8(ROPE_SEGMENT_COUNT, segCount);
  m.mem.write8(ROPE_EXTEND_INDEX, index);
  m.mem.write8(TAMPER_STRIKES_ROM, tamper);
  m.mem.write8(ROPE_EXTEND_STATE, 0x00);
  m.mem.write8(ROPE_EXTEND_TIMER, 0x00);
  m.mem.write8(ROPE_COLUMN_VRAM_PTR, 0x00);
  m.mem.write8(ROPE_COLUMN_VRAM_PTR + 1, 0x00);
  for (let i = 0; i < 4; i++) m.mem.write8(ROPE_CELL_TIMERS + 2 * i, 0x00);
  m.regs.sp = 0x8fe0; // dead stack: the byte-table lookup pushes/pops here
  return m;
}

// arrivals - 2 vs segment count decides the bound; keep tamper clear and index in the 0..3 band.
const CASES = [
  { name: "at bound (early return)", arrivals: 0x06, segCount: 0x04, index: 0x00, tamper: 0x00 },
  { name: "extend, index 0", arrivals: 0x06, segCount: 0x00, index: 0x00, tamper: 0x00 },
  { name: "extend, index 2", arrivals: 0x06, segCount: 0x00, index: 0x02, tamper: 0x00 },
  { name: "extend, index 3", arrivals: 0x06, segCount: 0x00, index: 0x03, tamper: 0x00 },
  { name: "index past limit, tamper clear (bail)", arrivals: 0x06, segCount: 0x00, index: 0x05, tamper: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted rope-machine cases — addRopeSegmentAndAdvanceExtendState == oracle in RAM (−stack)", () => {
  for (const { name, arrivals, segCount, index, tamper } of CASES) {
    const o = craft(arrivals, segCount, index, tamper);
    const c = craft(arrivals, segCount, index, tamper);
    oracle(o);
    addRopeSegmentAndAdvanceExtendState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the index-0 extend writes exactly six cells; the bail writes only the segment count", () => {
  // Extend at index 0: enumerate the exact footprint (column low byte read straight from the table).
  const col = BASE.mem.read8(ROPE_CELL_COLUMN_TABLE + 0x00);
  const before = craft(0x06, 0x00, 0x00, 0x00);
  const after = craft(0x06, 0x00, 0x00, 0x00);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();
  const changed = new Map();
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue; // the byte-table lookup pushes/pops here; not game state
    changed.set(addr, a1[off]);
  }
  const expected = new Map([
    [ROPE_SEGMENT_COUNT, 0x01],
    [ROPE_EXTEND_INDEX, 0x01],
    [ROPE_COLUMN_VRAM_PTR, col],
    [ROPE_COLUMN_VRAM_PTR + 1, VIDEO_PAGE],
    [ROPE_CELL_TIMERS, RELOAD],
    [ROPE_EXTEND_STATE, 0x01],
    [ROPE_EXTEND_TIMER, RELOAD],
  ]);
  // The column low byte can coincide with its seeded 0 if the table entry is 0; drop that lone cell.
  if (col === 0x00) expected.delete(ROPE_COLUMN_VRAM_PTR);
  assert.equal(changed.size, expected.size, `extend expected ${expected.size} writes, got ${changed.size}`);
  for (const [cell, val] of expected) {
    assert.ok(changed.has(cell), `extend missing a write at ${hx(cell)}`);
    assert.equal(changed.get(cell), val, `extend wrong value at ${hx(cell)}`);
  }

  // Past-limit bail: only the segment count is bumped.
  const bailBefore = craft(0x06, 0x00, 0x05, 0x00);
  const bailAfter = craft(0x06, 0x00, 0x05, 0x00);
  const c0 = bailBefore.dumpState();
  oracle(bailAfter);
  const c1 = bailAfter.dumpState();
  const bailChanged = [];
  for (let off = 0; off < c0.length; off++) if (c0[off] !== c1[off]) bailChanged.push(bailAfter.stateOffsetToAddr(off));
  assert.deepEqual(bailChanged, [ROPE_SEGMENT_COUNT], `bail must write only the segment count, got ${bailChanged.map(hx)}`);
  console.log("  WRITE-SET: extend -> six cells; bail -> segment count only");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted column-ptr byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x06, 0x00, 0x00, 0x00);
  const c = craft(0x06, 0x00, 0x00, 0x00);
  oracle(o);
  addRopeSegmentAndAdvanceExtendState(c);
  const cell = ROPE_COLUMN_VRAM_PTR + 1; // the fixed high byte of the column pointer
  c.mem.write8(cell, c.mem.read8(cell) ^ 0xff); // BUG: corrupt the video page byte
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted column-ptr byte — it is worthless");
  assert.equal(d.addr, cell, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(cell)})`);
  console.log(`  TEETH(col): corrupted column-ptr byte caught at ${hx(d.addr)}`);
});

test("TEETH: an undone sub-state advance is CAUGHT at the sub-state cell", () => {
  const o = craft(0x06, 0x00, 0x00, 0x00);
  const c = craft(0x06, 0x00, 0x00, 0x00);
  oracle(o);
  addRopeSegmentAndAdvanceExtendState(c);
  c.mem.write8(ROPE_EXTEND_STATE, (c.mem.read8(ROPE_EXTEND_STATE) - 1) & 0xff); // BUG: undo the advance
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an undone sub-state advance — it is worthless");
  assert.equal(d.addr, ROPE_EXTEND_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(ROPE_EXTEND_STATE)})`);
  console.log(`  TEETH(state): undone advance caught at ${hx(d.addr)}`);
});
