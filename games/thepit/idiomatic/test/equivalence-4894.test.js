// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawCreditsDisplay (ROM 0x4894, The Pit) — a fixed-panel
 * painter: it names one tile cell (column 6, row 10), asks the shared address
 * helpers for that cell's tilemap offset and colour-RAM / video-RAM cursors, then
 * stamps a panel (a live work-RAM value on top, an eight-glyph label below) and
 * tail-calls the colour-column filler.
 *
 * OBSERVABLE EQUIVALENCE. Three layout helpers are decompiled and called directly as JS —
 * rowColToTileOffset (0x3dae), deriveTileWriteCursors (0x3dc9) and fillColourColumn (0x3e01, the tail) —
 * so the routine no longer pushes those three return addresses. Two consequences the gate models:
 *   - the dead stack-scratch slot just below the entry stack pointer (where a dissolved CALL parked its
 *     return address) is EXCLUDED from the RAM diff — classic dead scratch. Here it is in fact re-covered
 *     by the two copy/fill helpers that STAY the oracle (0x3dea, 0x3ddb), so the window matches too.
 *   - the exit pc + SP: the oracle's tail 0x3e01 rets into drawCreditsDisplay's caller (SP += 2); the gate
 *     models that tail return with ONE m.ret() on the candidate — so pc + SP are still checked, not waived.
 * The two still-oracle copy/fill helpers are reached through the registry on both sides, so the gate tests
 * drawCreditsDisplay's own layout writes, its routing, and their IX-source + stack-return marshalling.
 *
 * WHY THIS ROUTINE IS INTERESTING FOR THE GATE:
 *
 *   1. It is entered from the movement core's periodic housekeeping (loc_03e8 calls
 *      it when a counter hits zero), which attract does reach — but only once, late
 *      (~frame 675). So a REAL captured dispatch is available: the harness runs a
 *      boot/attract and snapshots the genuine entry, no crafted forcing needed.
 *
 *   2. Its one state-dependent input is the live value at 0x8000 (copied into the top
 *      cell). Attract leaves it 0, so the real entry is swept over a range of values
 *      to exercise that input beyond what attract produces.
 *
 *   3. The behaviour that distinguishes it from its siblings: it does NOT reset the
 *      cell count to nine before the tail, so the colour fill covers eight cells, not
 *      nine. A teeth twin that restores the count-of-nine (the sibling behaviour) must
 *      be caught.
 *
 * EQUAL is proven on the real captured entry and across a 0x8000 sweep (observable RAM
 * outside the dead stack slot, plus pc + SP after the modelled return); the teeth twins
 * (wrong colour, an off-by-one label pointer that only surfaces in video RAM, a
 * count-of-nine colour run) are all caught at observable cells.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-4894.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_4894 as oracle } from "../../translated/loc_4894.js";
import { drawCreditsDisplay as idiomatic } from "../drawCreditsDisplay.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
// The three dissolved helpers, called directly by the idiomatic routine and mirrored by
// the teeth twins so each twin's only divergence from the oracle is its planted bug.
import { rowColToTileOffset } from "../rowColToTileOffset.js";
import { deriveTileWriteCursors } from "../deriveTileWriteCursors.js";
import { fillColourColumn } from "../fillColourColumn.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) =>
      nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x4894; // drawCreditsDisplay
const TILE_COL = 0x8058; // panel cell column byte
const TILE_ROW = 0x8059; // panel cell row byte
const FILL_ATTR = 0x8057; // colour attribute the colour run is painted in
const CELL_COUNT = 0x8055; // per-field cell count fed to the fill/copy helpers
const VALUE_SOURCE = 0x8000; // the live work-RAM value copied into the top cell
const LABEL_SOURCE = 0x496d; // ROM label glyph source (walked backwards)
const CAPTURE_FRAMES = 720; // 0x4894 first dispatches ~frame 675 — within this
// The 2-byte slot below the entry SP where the dissolved CALLs parked a return address: dead scratch.
const STACK_SCRATCH = 2;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Capture the real machine state at 0x4894's genuine attract dispatch. The hook
 * clones the pristine entry, then runs the oracle so the host run continues normally.
 */
function captureRealEntry() {
  let entry = null;
  const overrides = new Map([
    [TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }],
  ]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureRealEntry() : null;

/** First differing RAM byte, EXCLUDING the dead stack-scratch slot just below the entry stack pointer.
 *  Null when otherwise identical. */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Candidate vs oracle over the contract for one entry: RAM (outside the dead stack slot) + pc + SP, with
 * the oracle's tail return modelled by one m.ret() on the candidate. Returns { diffs, ram } (diffs empty == EQUAL).
 */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret(); // model the oracle's tail return so pc + SP line up

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

test("HARNESS: a real 0x4894 attract dispatch is captured and the oracle run is deterministic", () => {
  assert.ok(ENTRY, "expected 0x4894 to be dispatched during attract (from loc_03e8 housekeeping)");
  const a = ENTRY.clone();
  oracle(a);
  const b = ENTRY.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle exit pc not deterministic");
  console.log(`  HARNESS: captured a real 0x4894 entry (SP=${hx(ENTRY.regs.sp)}); oracle run deterministic`);
});

test("EQUAL (captured): idiomatic == oracle over observable RAM + pc + SP", () => {
  const { diffs, ram } = contractDiffs(ENTRY, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));
  assert.equal(ram, null, ram && `RAM diverged at ${hx(ram.addr ?? 0)}`);

  // Positive check: drawCreditsDisplay's distinguishing behaviour holds — the label field's count
  // of eight is left in place (not reset to nine) and the fill colour is 150.
  const c = ENTRY.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(CELL_COUNT), 8, "drawCreditsDisplay must leave the label field's count of eight in place");
  assert.equal(c.mem.read8(FILL_ATTR), 150, "drawCreditsDisplay must stage colour 150 for the label run");
  console.log("  EQUAL/captured: real 0x4894 entry identical (observable RAM + pc + SP); count=8, colour=150");
});

test("EQUAL (sweep): idiomatic == oracle across the live 0x8000 value", () => {
  const values = [0, 1, 2, 15, 55, 0x80, 0xa0, 0xff];
  for (const v of values) {
    const entry = ENTRY.clone();
    entry.mem.write8(VALUE_SOURCE, v);
    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, `v=${hx(v)}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/sweep: ${values.length} live-value inputs identical to the oracle (observable RAM + pc + SP)`);
});

// Each twin mirrors the idiomatic routine's exact (dissolved) structure and changes ONE
// thing, so each twin's only divergence is its bug — not a spurious stack difference.

/** Broken twin A: paints the colour run in the WRONG attribute. */
function brokenAttr(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 6);
  mem.write8(TILE_ROW, 10);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 151); // BUG: colour 151 instead of 150
  mem.write8(CELL_COUNT, 1);
  m.regs.ix = VALUE_SOURCE;
  m.push16(0x48b5); m.call(0x3dea);
  mem.write8(CELL_COUNT, 8);
  m.regs.ix = LABEL_SOURCE;
  m.push16(0x48c1); m.call(0x3ddb);
  return fillColourColumn(m);
}

/**
 * Broken twin B: an off-by-one label source pointer. The scratch bytes are written
 * exactly as the oracle does — this divergence surfaces ONLY through the still-oracle
 * fill helper (0x3ddb), as a wrong glyph in video RAM. Proves the gate catches a purely
 * callee-mediated effect, not just a directly-written scratch byte.
 */
function brokenLabelSource(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 6);
  mem.write8(TILE_ROW, 10);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 150);
  mem.write8(CELL_COUNT, 1);
  m.regs.ix = VALUE_SOURCE;
  m.push16(0x48b5); m.call(0x3dea);
  mem.write8(CELL_COUNT, 8);
  m.regs.ix = LABEL_SOURCE - 1; // BUG: label glyphs shifted by one
  m.push16(0x48c1); m.call(0x3ddb);
  return fillColourColumn(m);
}

/**
 * Broken twin C: restores the count-of-nine before the tail (the sibling behaviour).
 * drawCreditsDisplay's whole point is that it leaves eight in place, so this twin changes the
 * colour run and MUST be caught.
 */
function brokenColourCount(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 6);
  mem.write8(TILE_ROW, 10);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 150);
  mem.write8(CELL_COUNT, 1);
  m.regs.ix = VALUE_SOURCE;
  m.push16(0x48b5); m.call(0x3dea);
  mem.write8(CELL_COUNT, 8);
  m.regs.ix = LABEL_SOURCE;
  m.push16(0x48c1); m.call(0x3ddb);
  mem.write8(CELL_COUNT, 9); // BUG: sibling resets to 9; drawCreditsDisplay leaves 8
  return fillColourColumn(m);
}

test("TEETH: a wrong colour attribute is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenAttr);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a wrong colour — it is worthless");
  assert.equal(ram && ram.addr, FILL_ATTR, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected the attribute byte ${hx(FILL_ATTR)})`);
  console.log(`  TEETH: wrong colour caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: an off-by-one label pointer is CAUGHT downstream in video RAM", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenLabelSource);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a callee-mediated label error — it is worthless");
  // Scratch bytes are identical to the oracle; the first diff is a painted cell.
  assert.ok(ram.addr >= 0x8800, `teeth caught ${hx(ram.addr ?? 0)}, expected a painted colour/video cell (>= 0x8800)`);
  console.log(`  TEETH: off-by-one label caught downstream at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: restoring the count-of-nine colour run is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenColourCount);
  assert.ok(diffs.length > 0, "the gate FAILED to catch the count-of-nine colour run — it is worthless");
  console.log(`  TEETH: count-of-nine colour run caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

/** The correct routine, then one wrong store to a layout byte. */
function brokenCorruptOutput(m) {
  const r = idiomatic(m);
  m.mem.write8(TILE_COL, m.mem.read8(TILE_COL) ^ 0xff); // BUG: corrupts a layout byte
  return r;
}

test("TEETH: a corrupted output layout byte is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenCorruptOutput);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a corrupted layout byte — it is worthless");
  assert.equal(ram && ram.addr, TILE_COL, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(TILE_COL)})`);
  console.log(`  TEETH: corrupted layout byte caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
