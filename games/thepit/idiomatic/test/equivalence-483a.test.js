// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawMenLeftPanel (ROM 0x483a, The Pit) — the two-variant
 * panel painter: it names one tile cell (column 5), reads a live work-RAM byte to
 * pick a variant, turns that cell into its tilemap offset and colour-RAM / video-RAM
 * cursors, stamps a label (plus a live-value cell in the default variant), and paints
 * the run in one colour.
 *
 * CRAFTED ENTRY: attract never dispatches 0x483a — a boot run of hundreds of frames enters it zero times.
 * The entry is a REAL machine state captured at the sibling panel painter drawSetupCreditsPanel's genuine
 * frame-61 attract dispatch (this panel subsystem's scratch and video RAM live), and drawMenLeftPanel is
 * run on clones of it. The decision byte at 0x802b is forced to each of its two arms IDENTICALLY on both
 * sides, so any divergence is the rewrite's fault.
 *
 * OBSERVABLE EQUIVALENCE: three helpers are decompiled (rowColToTileOffset 0x3dae, deriveTileWriteCursors
 * 0x3dc9, fillColourColumn 0x3e01) and called as plain JS — no pushed return address; the glyph copy
 * helper at 0x3dea is still the oracle and keeps its call. The oracle's tail returns through the colour
 * filler, so exit pc and SP legitimately differ: the gate compares the RAM the panel writes, EXCLUDING the
 * dead stack-scratch window just below the entry stack pointer, and runs one ret() on the candidate so its
 * pc + SP meet the oracle's internal ret. (In practice the excluded window matches anyway — the retained
 * copy helper rewrites it last with the same value — but the dissolved helpers no longer own those bytes.)
 *
 * WHAT IS PROVEN:
 *   EQUAL on the default variant (the realistic 0x802b == 0 plus a sweep of the live
 *   displayed value) and on the alternate variant (0x802b == 1) over RAM (outside the
 *   stack scratch) + pc + SP; IDENTITY (oracle vs oracle, whole dump); and TEETH — a
 *   wrong colour (direct scratch), an off-by-one label pointer that surfaces only
 *   downstream in video RAM, and a post-hoc output corruption — all caught. The teeth
 *   twins are written in the same dissolved form as the routine and change ONE thing,
 *   so the caught diff is precisely the bug, never a spurious stack difference.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-483a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_483a as oracle } from "../../translated/loc_483a.js";
import { drawMenLeftPanel as idiomatic } from "../drawMenLeftPanel.js";
import { loc_3d49 as sibling } from "../../translated/loc_3d49.js";
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

const SIBLING = 0x3d49; // the reachable panel painter we snapshot a real state at
const PANEL_VALUE = 0x802b; // the live decision/display byte drawMenLeftPanel reads
const TILE_COL = 0x8058; // panel cell column byte (always 5)
const TILE_ROW = 0x8059; // panel cell row byte (11 default / 12 alt)
const FILL_ATTR = 0x8057; // colour attribute the panel is painted in
const CELL_COUNT = 0x8055; // per-field cell count fed to the copy/fill helpers
const DEFAULT_LABEL = 0x49ba; // ROM label glyph source, default variant (walked backwards)
const CAPTURE_FRAMES = 240; // drawSetupCreditsPanel first dispatches at frame 61 — well within this
const STACK_SCRATCH = 16; // dead bytes below the entry SP the oracle's helper returns parked
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Capture a real attract machine state at the sibling painter drawSetupCreditsPanel's genuine
 * frame-61 dispatch. The hook clones the pristine entry, then runs the sibling oracle
 * so the host run continues normally. drawMenLeftPanel is never driven on the host — only on
 * isolated clones of this real state.
 */
function captureRealEntry() {
  let entry = null;
  const overrides = new Map([
    [SIBLING, (mm) => {
      if (entry === null) entry = mm.clone();
      return sibling(mm);
    }],
  ]);
  const host = makeMachine(overrides);
  host.runFrames(CAPTURE_FRAMES);
  return entry;
}

const REAL = ROM_PRESENT ? captureRealEntry() : null;

/** A crafted entry: the real captured state with the decision byte forced to `value`. */
function craftedEntry(value) {
  const e = REAL.clone();
  e.mem.write8(PANEL_VALUE, value);
  return e;
}

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * window [entrySP - STACK_SCRATCH, entrySP) — the bytes the oracle's helper return
 * pushes park below the entry stack pointer, which the stack-free direct calls no
 * longer reproduce. Null when otherwise identical.
 */
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
 * Compare a candidate against the oracle over the observable-equivalence contract for
 * one entry: RAM (outside the stack scratch) + pc + SP. The oracle returns through the
 * colour filler (one internal ret); the candidate models its plain-JS return with one
 * ret() so pc + SP line up. Returns { diffs, ram } (diffs empty == EQUAL).
 */
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

test("EQUAL (default variant): idiomatic == oracle over RAM + pc + SP across the live 0x802b value", () => {
  assert.ok(REAL, "captured a real sibling-panel attract dispatch");
  // Every value but 1 takes the default arm; each is also the byte shown in the last
  // cell, so this sweeps the one state-dependent input the routine has.
  const values = [0, 2, 3, 7, 10, 0x80, 0xff];
  for (const v of values) {
    const { diffs } = contractDiffs(craftedEntry(v), idiomatic);
    assert.equal(diffs.length, 0, `v=${hx(v)}: ${diffs.join("; ")}`);
  }
  console.log(`  EQUAL/default: ${values.length} live-value inputs identical to the oracle (RAM outside stack + pc + SP)`);
});

test("EQUAL (alternate variant): idiomatic == oracle when 0x802b == 1", () => {
  const { diffs } = contractDiffs(craftedEntry(1), idiomatic);
  assert.equal(diffs.length, 0, diffs.join("; "));
  console.log("  EQUAL/alternate: 0x802b==1 arm identical to the oracle (RAM outside stack + pc + SP)");
});

// The oracle rets internally, so oracle-vs-oracle needs no ret handling and no stack
// exclusion — the whole dump (stack included) plus pc must match. Proves the capture,
// clone and diff plumbing is sound before the observable-equivalence gate leans on it.

test("IDENTITY: oracle vs oracle reports EQUAL on the whole dump (gate wiring sanity)", () => {
  for (const v of [0, 1]) {
    const entry = craftedEntry(v);
    const a = entry.clone();
    oracle(a);
    const b = entry.clone();
    oracle(b);
    const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(d, null, d && `identity RAM diff on v=${hx(v)} at ${hx(d.addr ?? 0)}`);
    assert.equal(a.pc, b.pc, `identity pc diff on v=${hx(v)}`);
    assert.equal(a.regs.sp, b.regs.sp, `identity SP diff on v=${hx(v)}`);
  }
  console.log("  IDENTITY: oracle vs oracle -> EQUAL on both arms (whole dump)");
});

// -- 4. TEETH: broken twins the gate MUST catch ------------------------------------
// Each twin is the SAME dissolved form as drawMenLeftPanel (direct helper calls, the 0x3dea
// copy helper kept as the oracle) and changes ONE thing, so the caught diff is
// precisely its bug — not a spurious stack difference.

/** Broken twin A: default arm, painted in the WRONG colour attribute. */
function brokenAttr(m) {
  const { mem, regs } = m;
  mem.write8(TILE_COL, 5);
  mem.write8(TILE_ROW, 11);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 152); // BUG: colour 152 instead of 151
  mem.write8(CELL_COUNT, 9);
  regs.ix = DEFAULT_LABEL;
  m.push16(0x4861); m.call(0x3dea);
  mem.write8(CELL_COUNT, 1);
  regs.ix = PANEL_VALUE;
  m.push16(0x486d); m.call(0x3dea);
  mem.write8(CELL_COUNT, 10);
  return fillColourColumn(m);
}

/**
 * Broken twin B: default arm with an off-by-one label source pointer. The scratch
 * bytes are written exactly as the routine does — this divergence surfaces ONLY through
 * the copy helper, as wrong glyphs in video RAM. Proves the gate catches a purely
 * callee-mediated effect, not just a directly-written scratch byte.
 */
function brokenLabelSource(m) {
  const { mem, regs } = m;
  mem.write8(TILE_COL, 5);
  mem.write8(TILE_ROW, 11);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
  mem.write8(FILL_ATTR, 151);
  mem.write8(CELL_COUNT, 9);
  regs.ix = DEFAULT_LABEL - 1; // BUG: label glyphs shifted by one
  m.push16(0x4861); m.call(0x3dea);
  mem.write8(CELL_COUNT, 1);
  regs.ix = PANEL_VALUE;
  m.push16(0x486d); m.call(0x3dea);
  mem.write8(CELL_COUNT, 10);
  return fillColourColumn(m);
}

/** Broken twin C: the correct idiomatic routine, then one wrong store. */
function brokenPostHoc(m) {
  const r = idiomatic(m);
  m.mem.write8(TILE_COL, m.mem.read8(TILE_COL) ^ 0xff); // BUG: corrupts a layout byte
  return r;
}

test("TEETH: a wrong colour attribute is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(craftedEntry(0), brokenAttr);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a wrong colour — it is worthless");
  assert.equal(ram && ram.addr, FILL_ATTR, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected the attribute byte ${hx(FILL_ATTR)})`);
  console.log(`  TEETH: wrong colour caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: an off-by-one label pointer is CAUGHT downstream in video RAM", () => {
  const { diffs, ram } = contractDiffs(craftedEntry(0), brokenLabelSource);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a callee-mediated label error — it is worthless");
  // Scratch bytes are identical to the oracle; the first diff is a painted cell.
  assert.ok(ram && ram.addr >= 0x8800, `teeth caught ${ram ? hx(ram.addr) : "(none)"}, expected a painted colour/video cell (>= 0x8800)`);
  console.log(`  TEETH: off-by-one label caught downstream at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});

test("TEETH: a post-hoc corrupted output is CAUGHT", () => {
  const { diffs, ram } = contractDiffs(craftedEntry(0), brokenPostHoc);
  assert.ok(diffs.length > 0, "the gate FAILED to catch a corrupted output — it is worthless");
  assert.equal(ram && ram.addr, TILE_COL, `teeth caught ${ram ? hx(ram.addr) : "(none)"} (expected ${hx(TILE_COL)})`);
  console.log(`  TEETH: corrupted layout byte caught at ${hx(ram.addr)} (oracle=${ram.a} broken=${ram.b})`);
});
