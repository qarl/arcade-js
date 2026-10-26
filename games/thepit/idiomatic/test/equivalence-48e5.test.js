// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawGameOverLabel (ROM 0x48e5, The Pit) — the HUD
 * label painter that stamps the nine-character "GAME OVER" run down its text
 * column. It names one tile cell (column 1, row 12), derives that cell's tilemap
 * offset and colour-RAM / video-RAM cursors (rowColToTileOffset, deriveTileWriteCursors),
 * copies the nine glyphs down the video column through the decompiled copy leaf
 * copyTileColumn (0x3dea), and paints the nine colour cells (fillColourColumn).
 *
 * WHY THE CONTRACT EXCLUDES A DEAD STACK-SCRATCH WORD (AND MODELS ONE RETURN):
 *   The oracle tail-jumps into the colour filler (0x3e01), whose own `ret` unwinds to drawGameOverLabel's
 *   caller (landing pc at the caller and SP two higher). The idiomatic routine calls the decompiled colour
 *   filler DIRECTLY, a plain JS return with no Z80 `ret`, so the gate models that one return with a single
 *   m.ret() on the candidate, which lines pc + SP up with the oracle. ALL four helpers are direct idiomatic
 *   calls — including the copy leaf (0x3dea) copyTileColumn, which takes its source pointer as a plain
 *   argument and touches no stack. So the idiomatic routine never pushes the copy-helper CALL's
 *   return-address word (0x4906) that the oracle parks just below the entry SP; that word is dead scratch
 *   (overwritten by the caller's next push before anything reads it) and is the ONLY residual divergence.
 *   The gate EXCLUDES the [SP-8, SP) stack-scratch window and compares everything else byte-for-byte —
 *   work/video/colour RAM + pc + SP. The real outputs (0x8055..0x8060 scratch, colour RAM >= 0x8800, video
 *   RAM >= 0x9000) all sit far below that window, so it never hides one; the teeth confirm it.
 *
 * WHY THIS ROUTINE IS STRAIGHTFORWARD FOR THE GATE:
 *
 *   1. It is entered from the HUD redraw (loc_472c) whenever no player is active —
 *      player count 0, the game-over state — which attract reaches early (0x48e5
 *      first dispatches ~frame 61). So a REAL captured dispatch is available with no
 *      crafted forcing, and the capture confirms player count 0 (the "GAME OVER" arm).
 *
 *   2. It is straight-line: fixed column/row, a fixed colour, a fixed row count, and
 *      a fixed ROM glyph source — no input-dependent branch. So the one real dispatch
 *      exercises the whole path; there is no state-dependent input to sweep.
 *
 * EQUAL is proven on the real captured entry over RAM + pc + SP; the teeth twins — a
 * wrong colour, an off-by-one glyph source that only surfaces in video RAM, a dropped
 * colour-fill effect, and a post-hoc output corruption — are all caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-48e5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_48e5 as oracle } from "../../translated/loc_48e5.js";
import { drawGameOverLabel as idiomatic } from "../drawGameOverLabel.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
// The teeth twins mirror the routine under test, so they call the same idiomatic helpers.
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

const TARGET = 0x48e5; // drawGameOverLabel
const STACK_SCRATCH = 8; // dead bytes the oracle's copy-helper CALL parks just below entry SP
const TILE_COL = 0x8058; // label cell column byte
const TILE_ROW = 0x8059; // label cell row byte
const FILL_ATTR = 0x8057; // colour attribute the label run is painted in
const CELL_COUNT = 0x8055; // row count fed to the copy and the colour fill
const TILE_OFFSET = 0x805a; // derived tilemap offset (row*32 + col)
const COLOUR_CURSOR = 0x805e; // derived colour-RAM write cursor
const GAME_OVER_SOURCE = 0x49a5; // ROM "GAME OVER" glyph source (walked backwards)
// Column 1, row 12 -> offset 32*12 + 1 = 385; colour cell = 0x8800 + 385, video cell = 0x9000 + 385.
const EXPECT_OFFSET = 385;
const FIRST_COLOUR_CELL = 0x8800 + EXPECT_OFFSET; // 0x8981 — top painted colour cell
const CAPTURE_FRAMES = 240; // 0x48e5 first dispatches ~frame 61 — within this
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Capture the real machine state at 0x48e5's genuine attract dispatch. The hook
 * clones the pristine entry, then runs the oracle so the host run continues normally.
 */
function captureRealEntry() {
  let entry = null;
  let playerCount = null;
  const overrides = new Map([
    [TARGET, (mm) => {
      if (entry === null) {
        entry = mm.clone();
        playerCount = mm.mem.read8(0x8001); // 0 in the game-over (GAME OVER) arm
      }
      return oracle(mm);
    }],
  ]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return { entry, playerCount };
}

const CAP = ROM_PRESENT ? captureRealEntry() : { entry: null, playerCount: null };
const ENTRY = CAP.entry;

/** First differing RAM byte, EXCLUDING the dead stack-scratch window [entrySP - STACK_SCRATCH, entrySP).
 *  Returns { addr, a, b } (a=oracle, b=cand) or null when otherwise equal. */
function stateDiffOutsideStack(o, c, entrySP) {
  const da = o.dumpState();
  const db = c.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = o.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - STACK_SCRATCH, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/**
 * Candidate vs oracle for one entry: work/video/colour RAM (outside the dead stack scratch) + pc + SP,
 * with one modelled return (m.ret()) on the candidate. Returns { diffs, ram } (diffs empty == EQUAL).
 */
function contractDiffs(entry, fn) {
  const entrySP = entry.regs.sp; // SP at 0x48e5 entry
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret(); // model the routine's return so pc + SP line up with the ret-ing oracle

  const diffs = [];
  const ram = stateDiffOutsideStack(o, c, entrySP);
  if (ram) diffs.push(`RAM@${hx(ram.addr ?? 0)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

test("HARNESS: a real GAME OVER (player count 0) dispatch is captured; the oracle run is deterministic", () => {
  assert.ok(ENTRY, "captured the real 0x48e5 attract dispatch");
  assert.equal(CAP.playerCount, 0, "the captured dispatch is the game-over (player count 0) arm");

  const a = ENTRY.clone();
  oracle(a);
  const b = ENTRY.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  assert.equal(a.regs.sp, b.regs.sp, "oracle SP not deterministic");
  console.log(`  HARNESS: real 0x48e5 entry (SP=${hx(ENTRY.regs.sp)}, player count 0); oracle run deterministic`);
});

test("EQUAL (captured): idiomatic == oracle on the real GAME OVER dispatch (RAM + pc + SP)", () => {
  const { diffs } = contractDiffs(ENTRY, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive checks: the pipeline really ran — layout scratch, colour cursor, and the
  // top colour cell painted with the label's colour (6).
  const c = ENTRY.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(TILE_COL), 1, "column not seated");
  assert.equal(c.mem.read8(TILE_ROW), 12, "row not seated");
  assert.equal(c.mem.read16(TILE_OFFSET), EXPECT_OFFSET, "tilemap offset not derived");
  assert.equal(c.mem.read16(COLOUR_CURSOR), FIRST_COLOUR_CELL, "colour cursor not derived");
  assert.equal(c.mem.read8(FILL_ATTR), 6, "fill colour not staged");
  assert.equal(c.mem.read8(CELL_COUNT), 9, "row count not staged");
  assert.equal(c.mem.read8(FIRST_COLOUR_CELL), 6, "top colour cell not painted with the label colour");
  console.log(`  EQUAL/captured: identical over RAM + pc + SP; colour cell ${hx(FIRST_COLOUR_CELL)} = 6, offset = ${EXPECT_OFFSET}`);
});

// The twins mirror the idiomatic routine's structure (direct helper calls plus the
// still-oracle copy helper) and change ONE thing, so each twin's only divergence is
// its bug.

/** Broken twin A: paints the label run in the WRONG colour attribute. */
function brokenAttr(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 1);
  mem.write8(TILE_ROW, 12);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 7); // BUG: colour 7 instead of 6
  mem.write8(CELL_COUNT, 9);
  m.regs.ix = GAME_OVER_SOURCE;
  m.push16(0x4906);
  m.call(0x3dea);
  return fillColourColumn(m);
}

/**
 * Broken twin B: an off-by-one glyph source pointer. Every scratch byte is written
 * exactly as the oracle does — this divergence surfaces ONLY through the copy helper,
 * as wrong glyphs in video RAM. Proves the gate catches a purely callee-mediated
 * effect (a wrong arg to the still-oracle copy helper), not just a directly-written
 * scratch byte.
 */
function brokenSource(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 1);
  mem.write8(TILE_ROW, 12);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 6);
  mem.write8(CELL_COUNT, 9);
  m.regs.ix = GAME_OVER_SOURCE - 1; // BUG: glyphs shifted by one
  m.push16(0x4906);
  m.call(0x3dea);
  return fillColourColumn(m);
}

/**
 * Broken twin C: drops the colour-fill effect entirely (skips fillColourColumn). Proves
 * the gate catches a MISSING decompiled-callee effect, not only a wrong value — the nine
 * colour cells go unpainted.
 */
function brokenDroppedFill(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 1);
  mem.write8(TILE_ROW, 12);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 6);
  mem.write8(CELL_COUNT, 9);
  m.regs.ix = GAME_OVER_SOURCE;
  m.push16(0x4906);
  m.call(0x3dea);
  // BUG: fillColourColumn(m) omitted — the colour cells are never painted.
}

/** Broken twin D: the correct routine, then one wrong store (post-hoc corruption). */
function brokenCorruptOutput(m) {
  const r = idiomatic(m);
  m.mem.write8(TILE_COL, m.mem.read8(TILE_COL) ^ 0xff); // BUG: corrupts a layout byte
  return r;
}

test("TEETH: a wrong colour attribute is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenAttr);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a wrong colour — it is worthless");
  assert.equal(ram && ram.addr, FILL_ATTR, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected the attribute byte ${hx(FILL_ATTR)})`);
  console.log(`  TEETH: wrong colour caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: an off-by-one glyph pointer is CAUGHT downstream in video RAM", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenSource);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a callee-mediated glyph error — it is worthless");
  // Scratch bytes are identical to the oracle; the first diff is a painted cell.
  assert.ok(ram.addr >= 0x8800, `teeth caught ${hx(ram.addr ?? 0)}, expected a painted colour/video cell (>= 0x8800)`);
  console.log(`  TEETH: off-by-one glyph caught downstream at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: a dropped colour-fill effect is CAUGHT at the colour cells", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenDroppedFill);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a dropped fill — it is worthless");
  assert.ok(ram.addr >= 0x8800 && ram.addr < 0x9000, `teeth caught ${hx(ram.addr ?? 0)}, expected an unpainted colour cell (0x8800..0x8fff)`);
  console.log(`  TEETH: dropped fill caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: a corrupted output byte is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenCorruptOutput);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a corrupted output — it is worthless");
  assert.equal(ram && ram.addr, TILE_COL, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(TILE_COL)})`);
  console.log(`  TEETH: corrupted layout byte caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
