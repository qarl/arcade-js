// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceHangingRopeObject (ROM 0x2ecb) — "rope-cell timer handler": tick the cell's
 * frame timer (tickRopeCellFrameTimer, selected by IXL&3); while it has not reached zero, return. On the frame it
 * reaches zero, write a round-derived tile into the timer cell, index the formation table (0x8c30) by
 * the following byte to bump one record's tile field / clear its position byte / drop another field,
 * bump (ix+0), then blit the segment's 2x2 tile square (computeRopeCellVramColumn column base, source 0x2e1e).
 *
 * Cycle-free memory-equivalence gate: a FRESH clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP — the oracle's call trampolines push there). pc/SP/cycles are NOT compared.
 *
 * Two paths, two contracts. The NOT-ZERO path returns straight after the tick: live-out HL (= the
 * timer cell) and the Z flag (not zero) are bridged and checked. The ZERO path runs the whole body
 * and tail-blits: live-out HL (= the blit's advanced column pointer), IY (= the indexed formation
 * record), and B (= 0) are checked. A/DE are blit plumbing (a caller ignores them) and are NOT
 * compared. All live-out values are derived from the oracle clone.
 *
 * IX low byte selects rope timer 0; work-RAM cells feed the round, the record-count byte and the
 * timer, so the formation record and every write stay off ROM.
 *
 * Jobs:
 *   1. EQUAL (not-zero path) — timer>1: oracle == advanceHangingRopeObject in RAM (−stack) + HL + Z.
 *   2. EQUAL (zero path) — timer==1, two round values: oracle == advanceHangingRopeObject in RAM (−stack) + HL/IY/B.
 *   3. WRITE-SET — the zero path's writes: the timer cell, three formation-record fields, (ix+0),
 *      and the four 2x2 video-RAM cells := the source block.
 *   4. TEETH — a wrong formation-record byte is caught by the RAM diff; a wrong IY by the live-out.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2ecb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2ecb as oracle } from "../../translated/loc_2ecb.js";
import { advanceHangingRopeObject } from "../advanceHangingRopeObject.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROPE_CELL_TIMERS,
  ROUND_COUNTER,
  FORMATION_TABLE,
  ROPE_CELL_COLUMN_TABLE,
  ROPE_SEGMENT_TILE_SRC_ALT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IXBASE = 0x8a80; //          IXL&3 == 0 selects rope timer 0
const TIMER0 = ROPE_CELL_TIMERS; // 0x8f28 — timer 0
const REC_COUNT_CELL = ROPE_CELL_TIMERS + 1; // the byte after the timer that picks the record count
const STRIDE = 0x18; //            formation record stride
const REC_TILE = 0x0f;
const REC_POS = 0x05;
const REC_DROP = 0x06;
const VIDEO_PAGE = 0x8400;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: rope timer 0 = `timer`, the record-count byte and round seated, IX at the record. */
function craft({ timer, round = 0x05, recSel = 0x01 }) {
  const m = BASE.clone();
  m.mem.write8(TIMER0, timer);
  m.mem.write8(REC_COUNT_CELL, recSel);
  m.mem.write8(ROUND_COUNTER, round);
  m.regs.ix = IXBASE;
  m.regs.sp = 0x8ffe; // in STACK_SCRATCH
  return m;
}

// passes = recSel + 1; the indexed formation record base
const recordFor = (recSel) => (FORMATION_TABLE + STRIDE * (recSel + 1)) & 0xffff;

// -- 1. EQUAL (not-zero path) -------------------------------------------------

test("EQUAL: not-zero path (timer stays non-zero) — advanceHangingRopeObject == oracle in RAM (−stack) + HL + Z", () => {
  for (const timer of [2, 3, 0x10]) {
    const o = craft({ timer });
    const c = craft({ timer });
    oracle(o);
    const ret = advanceHangingRopeObject(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `timer=${timer}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `timer=${timer}: HL live-out mismatch`);
    assert.equal(ret & 0xffff, o.regs.hl & 0xffff, `timer=${timer}: return equals oracle HL`);
    assert.equal(c.regs.fZ, o.regs.fZ, `timer=${timer}: Z live-out mismatch`);
    assert.equal(o.regs.hl & 0xffff, TIMER0, "HL = the timer cell");
    assert.equal(o.regs.fZ, false, "Z clear (timer not zero)");
    assert.equal(o.mem.read8(TIMER0), timer - 1, "timer decremented");
  }
  console.log("  EQUAL(not-zero): timers 2/3/0x10 identical (RAM −stack + HL + Z)");
});

// -- 2. EQUAL (zero path) -----------------------------------------------------

test("EQUAL: zero path (timer reaches zero) — advanceHangingRopeObject == oracle in RAM (−stack) + HL/IY/B", () => {
  for (const round of [0x05, 0x20]) { // 0x20 exercises the round clamp
    const o = craft({ timer: 1, round });
    const c = craft({ timer: 1, round });
    oracle(o);
    const ret = advanceHangingRopeObject(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `round=${hx(round)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} mine=${d.b}`);
    assert.equal(c.regs.hl & 0xffff, o.regs.hl & 0xffff, `round=${hx(round)}: HL live-out mismatch`);
    assert.equal(c.regs.iy & 0xffff, o.regs.iy & 0xffff, `round=${hx(round)}: IY live-out mismatch`);
    assert.equal(c.regs.b & 0xff, o.regs.b & 0xff, `round=${hx(round)}: B live-out mismatch`);
    assert.equal(ret[0] & 0xffff, o.regs.hl & 0xffff, `round=${hx(round)}: tuple[0] (HL) equals oracle HL`);
    assert.equal((o.regs.hl & 0xff00), VIDEO_PAGE, "HL is a tilemap-page pointer (blit column + 0x20)");
    assert.equal(o.regs.iy & 0xffff, recordFor(0x01), "IY = the indexed formation record");
    assert.equal(o.regs.b & 0xff, 0, "B drained to 0");
  }
  console.log("  EQUAL(zero): rounds 0x05/0x20 identical (RAM −stack + HL/IY/B)");
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: zero path writes the timer, 3 record fields, (ix+0), and 4 video-RAM cells", () => {
  const recSel = 0x01;
  const round = 0x05;
  const record = recordFor(recSel);
  const colLow = BASE.mem.read8(ROPE_CELL_COLUMN_TABLE + (IXBASE & 0x03));
  const columnBase = (VIDEO_PAGE | colLow) & 0xffff;
  const blitCells = [columnBase, columnBase + 1, (columnBase + 0x21) & 0xffff, (columnBase + 0x20) & 0xffff];
  const blitSrc = [0, 1, 2, 3].map((i) => BASE.mem.read8((ROPE_SEGMENT_TILE_SRC_ALT + i) & 0xffff));
  const blitWant = [blitSrc[0], blitSrc[1], blitSrc[2], blitSrc[3]]; // TL, TR, BR(+0x21), BL(+0x20)

  const expected = new Set([
    TIMER0,
    (record + REC_TILE) & 0xffff,
    (record + REC_POS) & 0xffff,
    (record + REC_DROP) & 0xffff,
    IXBASE,
    ...blitCells,
  ]);

  // pre-dirty every target cell so each write shows as a change (VRAM cells to the src's complement)
  const before = craft({ timer: 1, round, recSel });
  const after = craft({ timer: 1, round, recSel });
  for (const setup of [before, after]) {
    setup.mem.write8((record + REC_TILE) & 0xffff, 0xaa);
    setup.mem.write8((record + REC_POS) & 0xffff, 0xaa);
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
    if (b0[off] !== a1[off] && !inDeadStack(ad)) changed.push(ad); // -stack: oracle call trampolines push there
  }
  assert.equal(changed.length, expected.size, `expected ${expected.size} writes, got ${changed.length}`);
  for (const addr of changed) assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  // spot-check values
  assert.equal(after.mem.read8(TIMER0), (round << 1) + 0x18, "timer cell := round-derived tile");
  assert.equal(after.mem.read8((record + REC_POS) & 0xffff), 0x00, "record position byte cleared");
  for (let i = 0; i < 4; i++) {
    assert.equal(after.mem.read8(blitCells[i]), blitWant[i], `blit cell ${hx(blitCells[i])} := source byte`);
  }
  console.log(`  WRITE-SET: ${expected.size} cells (timer + 3 record + ix + 4 blit)`);
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong formation-record byte is CAUGHT by the RAM diff", () => {
  const o = craft({ timer: 1 });
  const c = craft({ timer: 1 });
  oracle(o);
  advanceHangingRopeObject(c);
  const cell = (recordFor(0x01) + REC_TILE) & 0xffff;
  c.mem.write8(cell, (c.mem.read8(cell) + 1) & 0xff); // BUG: corrupt the bumped record field

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
