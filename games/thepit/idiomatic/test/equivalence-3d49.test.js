// SPDX-License-Identifier: GPL-3.0-only
/**
 * Observable-equivalence gate for drawSetupCreditsPanel (ROM 0x3d49, The Pit) — the fixed-panel
 * painter: it names one tile cell (column 1, row 12), asks the shared address
 * helpers for that cell's tilemap offset and colour-RAM / video-RAM cursors, then
 * stamps a nine-cell vertical panel (a live work-RAM value on top, an eight-glyph
 * label below) and hands off to the colour-column filler.
 *
 * WHY THIS ROUTINE IS INTERESTING FOR THE GATE:
 *
 *   1. It is entered only during screen setup, which attract does reach — but late
 *      and rarely (0x3d49 dispatches at frame 61, then not again until ~1914). So a
 *      REAL captured dispatch is available: the harness runs a boot and snapshots the
 *      genuine frame-61 entry, no crafted forcing needed.
 *
 *   2. Three of its helpers are now decompiled and called directly by name
 *      (rowColToTileOffset 0x3dae, deriveTileWriteCursors 0x3dc9, and the colour tail
 *      fillColourColumn 0x3e01). The two glyph-stamping helpers (0x3dea for the live
 *      value, 0x3ddb for the ROM label) are still the frozen oracle, reached through
 *      the registry — both the oracle and the idiomatic routine run the identical
 *      callee for those two, so the gate only tests drawSetupCreditsPanel's own layout writes,
 *      its routing, and that the direct calls reproduce the helpers' RAM effects.
 *
 *   3. THE CONTRACT IS OBSERVABLE-MEMORY EQUIVALENCE. Dissolving the 0x3dae / 0x3dc9
 *      calls and the 0x3e01 tail-jump into direct JS calls removes the Z80 return-
 *      address pushes and the tail-jump's final `ret`, so the idiomatic routine no
 *      longer drives pc / SP the way the oracle does, and the two dead stack-scratch
 *      bytes just below the entry stack pointer are no longer modelled here. The gate
 *      therefore compares the work / colour / video RAM the routine actually paints,
 *      EXCLUDING that [SP-2, SP) scratch window, and lines pc + SP up by doing one
 *      ret() on the candidate (the oracle rets internally via the tail-jump; the
 *      idiomatic routine returns in plain JS). Value registers are the declared-dead
 *      live-out and are not part of the contract.
 *
 *   4. Its one state-dependent input is the live value at 0x8000 (copied into the top
 *      cell). Attract leaves it 0, so the real entry is swept over a range of values
 *      to exercise that input beyond what attract produces.
 *
 * EQUAL is proven on the real frame-61 entry and across a 0x8000 sweep; the teeth
 * twins (wrong colour, an off-by-one label pointer that only surfaces in video RAM,
 * and a DROPPED deriveTileWriteCursors call that proves the dissolved direct call is
 * load-bearing) are all caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-3d49.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3d49 as oracle } from "../../translated/loc_3d49.js";
import { drawSetupCreditsPanel as idiomatic } from "../drawSetupCreditsPanel.js";
import { rowColToTileOffset } from "../rowColToTileOffset.js";
import { deriveTileWriteCursors } from "../deriveTileWriteCursors.js";
import { fillColourColumn } from "../fillColourColumn.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) =>
      nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x3d49; // drawSetupCreditsPanel
const TILE_COL = 0x8058; // panel cell column byte
const TILE_ROW = 0x8059; // panel cell row byte
const FILL_ATTR = 0x8057; // colour attribute the panel is painted in
const CELL_COUNT = 0x8055; // per-field cell count fed to the fill/copy helpers
const COLOUR_CURSOR = 0x805e; // colour-RAM write cursor deriveTileWriteCursors stages
const VIDEO_CURSOR = 0x8060; // video-RAM write cursor deriveTileWriteCursors stages
const VALUE_SOURCE = 0x8000; // the live work-RAM value copied into the top cell
const LABEL_SOURCE = 0x496d; // ROM label glyph source (walked backwards)
const CAPTURE_FRAMES = 240; // 0x3d49 first dispatches at frame 61 — well within this
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The Pit's routine registry is async, so build the factory once and reuse it.
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Capture the real machine state at 0x3d49's genuine attract dispatch; the oracle then runs so the host continues. */
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

/**
 * First differing RAM byte between two machines, EXCLUDING the two dead stack-scratch
 * bytes just below the entry stack pointer. The oracle's dissolved 0x3dae / 0x3dc9
 * calls once pushed their return address into that [SP-2, SP) slot; the direct JS
 * calls do not, so those bytes are no longer part of the observable contract (they are
 * overwritten below SP and read by nothing). Null when otherwise identical.
 */
function ramDiffOutsideStack(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - 2, hi: entrySP }, entrySP)(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Compare a candidate against the oracle over the observable contract for one entry: RAM (outside the stack
 *  scratch) + pc + SP, after one ret() on the candidate (header). Returns { diffs, ram } (diffs empty == EQUAL). */
function contractDiffs(entry, fn) {
  const sp = entry.regs.sp;
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  c.ret();

  const diffs = [];
  const ram = ramDiffOutsideStack(o, c, sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return { diffs, ram };
}

test("HARNESS: a real 0x3d49 attract entry is captured and the oracle run is deterministic", () => {
  assert.ok(ENTRY, "expected 0x3d49 to be dispatched during attract (frame ~61)");
  const a = ENTRY.clone();
  oracle(a);
  const b = ENTRY.clone();
  oracle(b);
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  assert.equal(a.pc, b.pc, "oracle pc not deterministic");
  console.log(`  HARNESS: captured a real 0x3d49 entry (SP=${hx(ENTRY.regs.sp)}); oracle run deterministic`);
});

test("EQUAL (captured): idiomatic == oracle over painted RAM + pc + SP on the real frame-61 dispatch", () => {
  const { diffs } = contractDiffs(ENTRY, idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));

  // Positive checks: the panel really was staged and painted.
  const c = ENTRY.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(FILL_ATTR), 6, "panel colour attribute should be 6");
  assert.equal(c.mem.read8(CELL_COUNT), 9, "final run length should be the 9-cell colour pass");
  const cursor = c.mem.read16(COLOUR_CURSOR);
  assert.equal(c.mem.read8(cursor), 6, "top colour cell should be painted with attribute 6");
  console.log(`  EQUAL/captured: identical over painted RAM+pc+SP; colour cursor ${hx(cursor)} painted 6`);
});

test("EQUAL (sweep): idiomatic == oracle across the live 0x8000 value", () => {
  const values = [0, 1, 2, 15, 55, 0x80, 0xa0, 0xff];
  for (const v of values) {
    const entry = ENTRY.clone();
    entry.mem.write8(VALUE_SOURCE, v);
    const { diffs } = contractDiffs(entry, idiomatic);
    assert.equal(diffs.length, 0, `v=${hx(v)}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/sweep: ${values.length} live-value inputs identical to the oracle`);
});

// The twins mirror the DISSOLVED routine's exact structure (direct calls to the three
// decompiled helpers, m.call for the two still-oracle glyph helpers) and change ONE
// thing, so each twin's only divergence is its bug — not a spurious stack difference
// that would mask which byte the gate actually caught.

/** Broken twin A: paints the panel in the WRONG colour attribute. */
function brokenAttr(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 1);
  mem.write8(TILE_ROW, 12);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 7); // BUG: colour 7 instead of 6
  mem.write8(CELL_COUNT, 1);
  m.regs.ix = VALUE_SOURCE;
  m.push16(0x3d6a); m.call(0x3dea);
  mem.write8(CELL_COUNT, 8);
  m.regs.ix = LABEL_SOURCE;
  m.push16(0x3d76); m.call(0x3ddb);
  mem.write8(CELL_COUNT, 9);
  return fillColourColumn(m);
}

/** Broken twin B: an off-by-one label source pointer, handed to the still-oracle fill helper 0x3ddb. The scratch
 *  bytes are written exactly as the routine does — this divergence surfaces ONLY through the fill helper, as a wrong
 *  glyph in video RAM: a purely callee-mediated effect. */
function brokenLabelSource(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 1);
  mem.write8(TILE_ROW, 12);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 6);
  mem.write8(CELL_COUNT, 1);
  m.regs.ix = VALUE_SOURCE;
  m.push16(0x3d6a); m.call(0x3dea);
  mem.write8(CELL_COUNT, 8);
  m.regs.ix = LABEL_SOURCE - 1; // BUG: label glyphs shifted by one
  m.push16(0x3d76); m.call(0x3ddb);
  mem.write8(CELL_COUNT, 9);
  return fillColourColumn(m);
}

/** Broken twin C: DROPS the direct deriveTileWriteCursors call, so the colour / video write cursors (0x805e /
 *  0x8060) keep their stale entry values and every field paints at the wrong address. */
function brokenDropDerive(m) {
  const { mem } = m;
  mem.write8(TILE_COL, 1);
  mem.write8(TILE_ROW, 12);
  rowColToTileOffset(m);
  // BUG: deriveTileWriteCursors(m) dropped
  mem.write8(FILL_ATTR, 6);
  mem.write8(CELL_COUNT, 1);
  m.regs.ix = VALUE_SOURCE;
  m.push16(0x3d6a); m.call(0x3dea);
  mem.write8(CELL_COUNT, 8);
  m.regs.ix = LABEL_SOURCE;
  m.push16(0x3d76); m.call(0x3ddb);
  mem.write8(CELL_COUNT, 9);
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
  assert.ok(ram.addr >= 0x8800, `teeth caught ${hx(ram.addr)}, expected a painted colour/video cell (>= 0x8800)`);
  console.log(`  TEETH: off-by-one label caught downstream at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: a dropped deriveTileWriteCursors call is CAUGHT at the write cursor", () => {
  const { diffs, ram } = contractDiffs(ENTRY, brokenDropDerive);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a dropped decompiled-callee effect — it is worthless");
  // The dropped call leaves the colour/video cursors stale — caught at 0x805e or 0x8060.
  assert.ok(
    ram.addr === COLOUR_CURSOR || ram.addr === VIDEO_CURSOR,
    `teeth caught ${hx(ram.addr)} (expected a stale write cursor ${hx(COLOUR_CURSOR)}/${hx(VIDEO_CURSOR)})`,
  );
  console.log(`  TEETH: dropped deriveTileWriteCursors caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
