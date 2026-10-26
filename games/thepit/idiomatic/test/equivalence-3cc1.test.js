// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for drawSharedPanel (ROM 0x3cc1, The Pit) — the shared fixed-panel
 * layout: it stamps the left edge column and both players' score HUD, places three
 * labelled tile/colour runs (a ROM label strip at column 7 row 9; a dynamic glyph from
 * the game-state byte plus a filled strip at column 9 row 13; a second ROM label strip
 * plus a colour-column accent at column 13 row 9), then stamps the right edge column
 * and the playfield column with its trim.
 *
 * WHY A CRAFTED ENTRY. This layout is only reached from the status-screen builders
 * (0x3bec / 0x4df8), so it never dispatches in a plain attract run (confirmed: 0 hits
 * in 5000 frames). Per the crafted-entry method the gate instead runs it from a REAL
 * board-setup machine state: its own first callee, the edge-column stamper 0x46f4, DOES
 * dispatch during attract's board setup, so the state captured at 0x46f4's entry is the
 * exact machine state 0x3cc1 hands to its first call — the most faithful possible entry,
 * with a valid stack and an in-play work-RAM configuration. The routine is straight-line
 * with no input-dependent branch, so that one entry exercises the whole path.
 *
 * THE CONTRACT IS OBSERVABLE-RAM EQUIVALENCE, STACK SCRATCH BELOW THE ENTRY SP EXCLUDED. The registry
 * resolves every m.call to the frozen translated oracle, so the oracle run reaches its
 * HUD/score helpers as deeply-nested translated routines that leave dead return-address
 * scratch on the work stack; the idiomatic routine calls those same helpers as direct
 * JS, so its stack activity is shallower and the dead scratch differs. That scratch is
 * dead by definition (the stack lives at the top of work RAM, 0x83ff down; nothing reads
 * it back). Measured, the ENTIRE divergence is six bytes in [0x83f5, 0x83fa], just below the
 * top of the stack — every video cell, every colour cell, and all meaningful work RAM
 * (including the plotter staging cells 0x8055-0x8060) is byte-identical. So the diff
 * compares the whole state dump EXCEPT stack scratch below the entry SP,
 * and excludes pc + SP + the dead register file (the honest-signature live-out is
 * memory-only; the oracle's tail-jump return is not modelled here because pc/SP are out
 * of contract). The oracle writes nothing meaningful in [0x8130, 0x83e0), so the window
 * hides nothing real — teeth prove it.
 *
 * Checks:
 *   0. HARNESS  — a real 0x46f4 board-setup entry is captured; the oracle run of 0x3cc1
 *      is deterministic (oracle vs oracle identical outside the stack window).
 *   1. EQUAL    — idiomatic == oracle over the observable RAM (video + colour + work RAM
 *      minus stack scratch below the entry SP), and the layout really ran (staging cells + a nonzero,
 *      matching count of display cells changed).
 *   2. SENTINEL — over a marker-filled colour+video background every write is a real
 *      change; the oracle writes the same set of cells as idiomatic, non-vacuously.
 *   3. TEETH    — three structural twins, each differing from the routine by ONE thing:
 *      a wrong run-1 colour (caught in colour RAM), a shifted run-1 glyph source (caught
 *      downstream in video RAM through the still-oracle copy helper), and a dropped right
 *      playfield column (caught as unpainted video/colour cells).
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-3cc1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3cc1 as oracle } from "../../translated/loc_3cc1.js";
import { loc_46f4 as oracle46f4 } from "../../translated/loc_46f4.js";
import { drawSharedPanel as idiomatic } from "../drawSharedPanel.js";
import { makeMachineFactory } from "../../machine.js";
// The teeth twins mirror the routine, so they drive the same idiomatic helpers.
import { drawLeftEdgeColumn } from "../drawLeftEdgeColumn.js";
import { redrawScoreHud } from "../redrawScoreHud.js";
import { rowColToTileOffset } from "../rowColToTileOffset.js";
import { deriveTileWriteCursors } from "../deriveTileWriteCursors.js";
import { fillColourColumn } from "../fillColourColumn.js";
import { drawBestScoresTodayLabel } from "../drawBestScoresTodayLabel.js";
import { drawRightEdgeColumn } from "../drawRightEdgeColumn.js";
import { TILE_COL, TILE_ROW, PLOT_RUN_LENGTH, ACTIVE_PLAYER } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const CAPTURE_AT = 0x46f4; // 0x3cc1's own first callee — a real board-setup dispatch in attract
const CAP_FRAMES = 400;
const FILL_ATTR = 0x8057; // the panel's colour attribute cell (0x3e1d also caches its C here)
const STACK_TOP = 0x8400; // work RAM ends here; the stack grows down from 0x83ff
const STACK_MARGIN = 32; // dead-scratch headroom below the entry stack top (measured reach: 6 bytes)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async,
// so build the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- capture ------------------------------------------------------------------

/**
 * Capture the machine at 0x46f4's genuine board-setup dispatch during attract. The hook
 * clones the pristine entry, then runs the oracle edge-column stamper so the host run
 * continues normally. This is the state 0x3cc1 would hand to its own first call.
 */
function captureBoardSetupEntry(maxFrames) {
  let entry = null;
  const overrides = new Map([[CAPTURE_AT, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle46f4(mm);
  }]]);
  const host = makeMachine(overrides);
  host.runFrames(maxFrames);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureBoardSetupEntry(CAP_FRAMES) : null;

// -- the observable-RAM contract ----------------------------------------------

/**
 * First RAM byte that differs between two machines, EXCLUDING stack scratch below the
 * entry SP ([entrySP - STACK_MARGIN, entrySP)). Everything else —
 * all video, colour, and meaningful work RAM — is compared byte-for-byte. Null when the
 * observable state is identical.
 */
function observableDiff(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  const dead = deadStackBelow({ lo: entrySP - STACK_MARGIN, hi: STACK_TOP }, entrySP);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue; // dead stack scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** Run the oracle and a candidate on fresh clones of `entry`; diff observable RAM. */
function contractDiff(entry, fn) {
  const o = entry.clone();
  oracle(o);
  const c = entry.clone();
  fn(c);
  return observableDiff(o, c, entry.regs.sp);
}

/** Count observable (non-stack) state cells a run changes from `entry`. */
function observableWriteCount(entry, fn) {
  const before = entry.dumpState();
  const c = entry.clone();
  fn(c);
  const after = c.dumpState();
  const dead = deadStackBelow({ lo: entry.regs.sp - STACK_MARGIN, hi: STACK_TOP }, entry.regs.sp);
  let n = 0;
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const addr = c.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    n += 1;
  }
  return n;
}

// -- the panel body, parameterised for the teeth twins -------------------------
// This mirrors the idiomatic routine exactly at its default options; each twin flips ONE
// knob so its only divergence from the real routine is its injected bug. The EQUAL test
// uses the real imported idiomatic routine; a base-fidelity check ties this mirror to it.

function copyGlyphsDown(m, source, returnSlot) {
  m.regs.ix = source;
  m.push16(returnSlot);
  m.call(0x3dea);
}
function fillStripDown(m, source, returnSlot) {
  m.regs.ix = source;
  m.push16(returnSlot);
  m.call(0x3ddb);
}
function paintColourRamColumn(m, column, colour) {
  m.regs.a = column;
  m.regs.c = colour;
  m.push16(0x3d43);
  m.call(0x3e1d);
}
function seatCell(m, column, row) {
  m.mem.write8(TILE_COL, column);
  m.mem.write8(TILE_ROW, row);
  rowColToTileOffset(m);
  deriveTileWriteCursors(m);
}

function paintPanel(m, opts = {}) {
  const run1Colour = opts.run1Colour ?? 0xa5;
  const run1Source = opts.run1Source ?? 0x497b;
  const dropEdgeColumn = opts.dropEdgeColumn ?? false;
  const { mem } = m;

  drawLeftEdgeColumn(m);
  redrawScoreHud(m);

  seatCell(m, 7, 9);
  mem.write8(FILL_ATTR, run1Colour);
  mem.write8(PLOT_RUN_LENGTH, 15);
  copyGlyphsDown(m, run1Source, 0x3ce8);
  fillColourColumn(m);

  seatCell(m, 9, 13);
  mem.write8(FILL_ATTR, 0xa5);
  mem.write8(PLOT_RUN_LENGTH, 1);
  copyGlyphsDown(m, ACTIVE_PLAYER, 0x3d0c);
  mem.write8(PLOT_RUN_LENGTH, 7);
  fillStripDown(m, 0x49b1, 0x3d18);
  mem.write8(PLOT_RUN_LENGTH, 8);
  fillColourColumn(m);

  seatCell(m, 13, 9);
  mem.write8(PLOT_RUN_LENGTH, 15);
  copyGlyphsDown(m, 0x49f7, 0x3d3c);
  paintColourRamColumn(m, 13, 0xa3);

  if (!dropEdgeColumn) drawBestScoresTodayLabel(m); // BUG hook: skip the right edge column
  return drawRightEdgeColumn(m);
}

// -- 0. HARNESS ----------------------------------------------------------------

test("HARNESS: a real 0x46f4 board-setup entry is captured; the oracle run of 0x3cc1 is deterministic", () => {
  assert.ok(ENTRY, "expected 0x46f4 to dispatch during attract's board setup");

  const a = ENTRY.clone();
  oracle(a);
  const b = ENTRY.clone();
  oracle(b);
  const d = observableDiff(a, b, ENTRY.regs.sp);
  assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  console.log(`  HARNESS: captured a real 0x46f4 entry (SP=${hx(ENTRY.regs.sp)}); oracle run of 0x3cc1 deterministic`);
});

// -- 1. EQUAL ------------------------------------------------------------------

test("EQUAL (captured): idiomatic drawSharedPanel == oracle over observable RAM", () => {
  const d = contractDiff(ENTRY, idiomatic);
  assert.equal(d, null, d && `observable RAM diff at ${hx(d.addr)} (oracle=${d.a} cand=${d.b})`);

  // The routine really ran: the last-seated cell, the cached colour attribute, and the
  // same nonzero count of display cells the oracle writes.
  const c = ENTRY.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(TILE_COL), 13, "last tile column not seated");
  assert.equal(c.mem.read8(TILE_ROW), 9, "last tile row not seated");
  // The playfield column's own colour fill is the routine's last act; it caches its
  // colour (2) at 0x8057, so that byte reads 2 at exit — a marker the tail really ran.
  assert.equal(c.mem.read8(FILL_ATTR), 2, "playfield-column colour not cached at 0x8057 (tail did not run)");

  const oracleWrites = observableWriteCount(ENTRY, oracle);
  const idiomaticWrites = observableWriteCount(ENTRY, idiomatic);
  assert.ok(oracleWrites > 40, `expected the panel to change many display cells, got ${oracleWrites}`);
  assert.equal(idiomaticWrites, oracleWrites, "idiomatic changed a different number of cells than the oracle");
  console.log(`  EQUAL/captured: identical observable RAM; ${idiomaticWrites} display/work cells changed, matching the oracle`);
});

// -- base fidelity: the teeth mirror IS the routine at default options ----------

test("MIRROR: paintPanel() at default options == idiomatic drawSharedPanel (so each twin's only diff is its bug)", () => {
  const d = contractDiff(ENTRY, (m) => paintPanel(m));
  assert.equal(d, null, d && `mirror diverges from idiomatic at ${hx(d.addr)} (oracle=${d.a} mirror=${d.b})`);
  console.log("  MIRROR: the parameterised twin base reproduces the routine exactly");
});

// -- 2. SENTINEL ---------------------------------------------------------------

/** Sentinel-fill colour (0x8800-0x8bff) + video (0x9000-0x93ff) RAM so every write shows. */
function sentinelFill(m, val) {
  for (let a = 0x8800; a <= 0x8bff; a++) m.mem.write8(a, val);
  for (let a = 0x9000; a <= 0x93ff; a++) m.mem.write8(a, val);
}

test("SENTINEL (crafted): over a marker background the oracle and idiomatic write the same cells", () => {
  const w = ENTRY.clone();
  sentinelFill(w, 0x5a);

  const oracleWrites = observableWriteCount(w, oracle);
  assert.ok(oracleWrites > 60, `over the sentinel background the oracle should write many cells, got ${oracleWrites}`);

  const d = contractDiff(w, idiomatic);
  assert.equal(d, null, d && `sentinel background: observable RAM diff at ${hx(d.addr)} (oracle=${d.a} cand=${d.b})`);
  console.log(`  SENTINEL: ${oracleWrites} writes over a marker background — idiomatic identical to the oracle`);
});

// -- 3. TEETH ------------------------------------------------------------------

test("TEETH: a wrong run-1 colour attribute is CAUGHT in colour RAM", () => {
  const d = contractDiff(ENTRY, (m) => paintPanel(m, { run1Colour: 0xa4 }));
  assert.ok(d, "the gate FAILED to catch a wrong colour — it is worthless");
  assert.ok(d.addr >= 0x8800 && d.addr < 0x8c00, `expected a colour-RAM diff, got ${hx(d.addr)}`);
  console.log(`  TEETH/colour: wrong run-1 colour caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a shifted run-1 glyph source is CAUGHT downstream in video RAM", () => {
  const d = contractDiff(ENTRY, (m) => paintPanel(m, { run1Source: 0x497a }));
  assert.ok(d, "the gate FAILED to catch a callee-mediated glyph error — it is worthless");
  // Every directly-written cell is identical; the divergence surfaces through the copy
  // helper as wrong glyphs in video RAM.
  assert.ok(d.addr >= 0x9000 && d.addr < 0x9400, `expected a video-RAM diff, got ${hx(d.addr)}`);
  console.log(`  TEETH/glyphs: shifted run-1 source caught downstream at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a dropped right edge column is CAUGHT in display RAM", () => {
  const d = contractDiff(ENTRY, (m) => paintPanel(m, { dropEdgeColumn: true }));
  assert.ok(d, "the gate FAILED to catch a dropped column — it is worthless");
  assert.ok(d.addr >= 0x8800 && d.addr < 0x9800, `expected a video/colour-RAM diff, got ${hx(d.addr)}`);
  console.log(`  TEETH/drop: dropped edge column caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
