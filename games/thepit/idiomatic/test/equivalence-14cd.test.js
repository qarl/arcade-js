// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for locateObjectCellCheckGoal (ROM 0x14cd) — locate the object's tilemap cell, latch a goal
 * crossing if the goal is just ahead, else resolve the tile under it.
 *
 * locateObjectCellCheckGoal is the positioning front of the tile-under-object path: from the object's screen row (a
 * register live-in, surfaced as `row`) plus its row/column coordinates it derives the tilemap cell
 * (publishing PLAYER_TILE_COL + PLAYER_CELL_PTR), clears the ahead-tile scratch (NEXT_TILE), then either
 * latches the two goal flags and walks (when the cell ahead is the goal tile and the object is
 * cross-axis grid-aligned) or hands the whole step to the resolver collectAlignedLootElseResolveTile. Its declared LIVE-OUT is
 * MEMORY-ONLY.
 *
 * STACK-TOP WINDOW. locateObjectCellCheckGoal itself pushes nothing, but the loot awards inside the delegated resolver
 * reach the score adder through the oracle's ordinary calls (0x467b / 0x4683), which park a return
 * address the stack-free idiomatic cascade never writes. As measured for collectAlignedLootElseResolveTile, the oracle leaves
 * at most a handful of dead bytes just below the entry stack pointer, so the diff excludes a small
 * [SP-16, SP) window — well above the work + video RAM this routine writes — and compares everything
 * else byte-for-byte. Registers/flags/pc/SP are the honest-signature dead live-out and never compared;
 * the `row` live-in defaults to the register so a no-arg call reproduces the oracle.
 *
 * REACHED IN ATTRACT. Unlike its resolver siblings, locateObjectCellCheckGoal IS dispatched during attract (measured 61
 * dispatches in 4000 frames), so the gate validates every real captured entry directly. The arms the
 * demo never drives — the goal-ahead latch and the loot/push cases — are covered by crafted entries
 * built on real attract clones (a valid stack, video RAM, object record) with the row / column / cell
 * inputs poked: the object's cell is forced onto an isolated video-RAM cell so the tile under it and
 * the tile ahead are controllable, and the under tile is swept over all 256 ids across every sub-offset.
 *
 * Checks:
 *   0. HARNESS — confirm attract dispatches 0x14cd, capture real entries, and oracle-vs-oracle on a
 *      real entry is deterministic (the capture/clone/replay plumbing works).
 *   1. EQUAL (real captured entries) — idiomatic == oracle over every real 0x14cd dispatch.
 *   2. EQUAL (under-tile sweep) — every under-tile id 0..255 across every sub-offset (the delegated
 *      resolve): both loot kinds when aligned, and the terrain delegation everywhere else.
 *   3. EQUAL (goal-ahead latch) — the cell ahead is the goal tile and the object is cross-axis aligned:
 *      both goal flags latch and the walk step runs, identical to the oracle.
 *   4. NON-VACUOUS — a crafted entry really writes RAM; a no-op twin cannot pass.
 *   5. TEETH (goal latch) — a twin that drops the goal-tile latch is CAUGHT at GOAL_TILE_LATCH.
 *   6. TEETH (ahead scratch) — a twin that skips clearing the ahead-tile scratch is CAUGHT at NEXT_TILE.
 *   7. TEETH (cell column) — a twin that corrupts the published tile column is CAUGHT at PLAYER_TILE_COL.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-14cd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_14cd as oracle } from "../../translated/loc_14cd.js";
import { locateObjectCellCheckGoal as idiomatic } from "../locateObjectCellCheckGoal.js";
import { makeMachineFactory } from "../../machine.js";
import {
  PLAYER_X,
  PLAYER_Y,
  PLAYER_TILE_COL,
  NEXT_TILE,
  GOAL_TILE_LATCH,
  PIT_CROSS_ACTIVE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x14cd;
const VRAM_BASE = 0x9000; // video-RAM base the tilemap cells hang off
const ROW_STRIDE = 32; // cells per tilemap row
const CRAFT_ROW = 16; // screen row for crafted cells: keeps the cell inside one video-RAM page (0x9200..)
const GOAL_TILE = 39; // the tile id the object crosses at the goal
const STACK_WINDOW = 16; // dead stack-top bytes below entry SP the oracle's award CALLs park
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build the
// factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- capture helpers ------------------------------------------------------------------------------

/** Hook 0x14cd in a real attract run; clone the machine at each dispatch (a genuine entry state, with
 *  the screen row already in the register the routine reads). The wrapper runs the oracle so attract
 *  proceeds undisturbed. */
function captureEntries(maxFrames, limit) {
  const entries = [];
  const hook = new Map([[TARGET, (mm) => {
    if (entries.length < limit) entries.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(hook).runFrames(maxFrames);
  return entries;
}

/** A spread of plain attract clones to craft the never-reached arms from. */
function captureStates(count, stride, startFrame) {
  const m = makeMachine();
  m.runFrames(startFrame);
  const caps = [];
  for (let i = 0; i < count; i++) {
    m.runFrames(stride);
    caps.push(m.clone());
  }
  return caps;
}

/** The video-RAM cell locateObjectCellCheckGoal computes for a given screen row + object column coordinate. */
function cellFor(row, objY) {
  const column = (objY + 5) & 0xff;
  return (VRAM_BASE + row * ROW_STRIDE + (column >> 3)) & 0xffff;
}

/**
 * Craft an entry from a real base: set the screen row (register live-in), the object's row/column
 * coordinates (objY drives the tile column + sub-offset; objX drives the cross-axis alignment), then
 * write the tile under the object and the tile one step ahead at the cell locateObjectCellCheckGoal will compute.
 * Returns the entry plus the cell address for assertions.
 */
function craft(base, { row = CRAFT_ROW, objY, objX = 0, underTile, aheadTile = 0x74 }) {
  const e = base.clone();
  e.regs.h = row;
  e.mem.write8(PLAYER_X, objY);
  e.mem.write8(PLAYER_Y, objX);
  const cellPtr = cellFor(row, objY);
  e.mem.write8(cellPtr, underTile);
  e.mem.write8((cellPtr + 1) & 0xffff, aheadTile);
  return { e, cellPtr };
}

/**
 * Run oracle and candidate on independent clones of `entry`; return the first differing RAM byte
 * OUTSIDE the dead stack-top window [SP-STACK_WINDOW, SP), or null. Registers/flags/pc/SP are the
 * honest-signature dead live-out and never compared; the idiomatic `row` live-in defaults to the
 * register.
 */
function ramDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: sp - STACK_WINDOW, hi: sp }, sp)(addr)) continue; // dead stack-top scratch
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// -- 0. HARNESS: attract reaches 0x14cd; oracle-vs-oracle on a real entry is deterministic ---------

test("HARNESS: 0x14cd is dispatched in attract, entries capture, and oracle-vs-oracle is EQUAL", () => {
  const entries = captureEntries(2000, 40);
  assert.ok(entries.length >= 1, `expected 0x14cd to be dispatched in attract, captured ${entries.length}`);
  assert.equal(ramDiff(entries[0], oracle), null, "oracle vs oracle must be identical on a real entry");
  console.log(`  HARNESS: captured ${entries.length} real 0x14cd entries; oracle-vs-oracle EQUAL (SP=${hx(entries[0].regs.sp)})`);
});

// -- 1. EQUAL over every real captured attract dispatch -------------------------------------------

test("EQUAL (real entries): locateObjectCellCheckGoal leaves the same RAM as the oracle over every real dispatch", () => {
  const entries = captureEntries(2000, 40);
  assert.ok(entries.length >= 1, "expected at least one captured 0x14cd entry");
  for (const entry of entries) {
    const d = ramDiff(entry, idiomatic);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${entries.length} real 0x14cd dispatches — RAM identical to the oracle`);
});

// -- 2. EQUAL over the full under-tile sweep (delegated resolve) ----------------------------------

test("EQUAL (under-tile sweep): every under-tile id across every sub-offset matches the oracle", () => {
  const [base] = captureStates(1, 1, 200);
  // objY values chosen to exhaust the sub-offset (column & 7 = (objY+5)&7): 3->0, 4->1 .. 2->7, plus
  // two that also move the tile column (÷8). objX=0 keeps the cross-axis unaligned so the goal arm
  // never fires (and the ahead tile 0x74 is not the goal tile anyway) — every case delegates.
  const objYs = [3, 4, 5, 6, 7, 0, 1, 2, 0x28, 0xfa];
  let n = 0;
  for (let underTile = 0; underTile < 256; underTile++) {
    for (const objY of objYs) {
      const { e } = craft(base, { objY, underTile, aheadTile: 0x74 });
      const d = ramDiff(e, idiomatic);
      assert.equal(d, null, d && `under=${hx(underTile)} objY=${hx(objY)}: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
      n++;
    }
  }
  console.log(`  EQUAL/under: ${n} (under-tile, objY) combinations — RAM identical (all 256 ids)`);
});

// -- 3. EQUAL over the goal-ahead latch path -----------------------------------------------------

test("EQUAL (goal-ahead latch): the goal tile ahead + cross-axis aligned latches both flags, matches oracle", () => {
  const [base] = captureStates(1, 1, 240);
  // objX = 5 -> (5+3)&7 == 0, cross-axis aligned; the cell ahead holds the goal tile.
  const { e } = craft(base, { objY: 3, objX: 5, underTile: 0x30, aheadTile: GOAL_TILE });
  e.mem.write8(GOAL_TILE_LATCH, 0);
  e.mem.write8(PIT_CROSS_ACTIVE, 0);

  assert.equal(ramDiff(e, idiomatic), null, "the goal-ahead path must match the oracle");

  const c = e.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), 1, "the goal-tile latch was not set");
  assert.equal(c.mem.read8(PIT_CROSS_ACTIVE), 1, "the goal-crossing latch was not set");
  console.log("  EQUAL/goal: both goal flags latched and the walk step ran, identical to the oracle");
});

// -- 4. NON-VACUOUS: a crafted entry writes RAM; a no-op twin cannot pass -------------------------

test("NON-VACUOUS: a crafted entry really writes RAM; a no-op twin is caught", () => {
  const [base] = captureStates(1, 1, 260);
  const { e } = craft(base, { objY: 3, objX: 5, underTile: 0x30, aheadTile: GOAL_TILE });
  e.mem.write8(GOAL_TILE_LATCH, 0);

  const noop = ramDiff(e, () => {});
  assert.notEqual(noop, null, "a no-op twin passed — the entry writes nothing, so the gate is vacuous");
  assert.equal(ramDiff(e, idiomatic), null, "the real routine must match the oracle on the same entry");
  console.log(`  NON-VACUOUS: no-op twin caught at ${hx(noop.addr)}; real routine matches the oracle`);
});

// -- 5. TEETH (goal latch): a dropped goal-tile latch is CAUGHT -----------------------------------

/** Broken twin: does the real work, then reverts the goal-tile latch. */
function twinNoGoalLatch(m) {
  const before = m.mem.read8(GOAL_TILE_LATCH);
  idiomatic(m);
  m.mem.write8(GOAL_TILE_LATCH, before); // BUG: un-latch the goal
}

test("TEETH (goal latch): a twin that drops the goal-tile latch is CAUGHT at GOAL_TILE_LATCH", () => {
  const [base] = captureStates(1, 1, 280);
  const { e } = craft(base, { objY: 3, objX: 5, underTile: 0x30, aheadTile: GOAL_TILE });
  e.mem.write8(GOAL_TILE_LATCH, 0);

  const d = ramDiff(e, twinNoGoalLatch);
  assert.notEqual(d, null, "the gate FAILED to catch a dropped goal latch — it proves nothing");
  assert.equal(d.addr, GOAL_TILE_LATCH, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(GOAL_TILE_LATCH)})`);
  assert.equal(ramDiff(e, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/goal: dropped goal latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 6. TEETH (ahead scratch): a skipped ahead-tile clear is CAUGHT -------------------------------

/** Broken twin: does the real work, then restores the ahead-tile scratch (never clears it). */
function twinNoAheadClear(m) {
  const before = m.mem.read8(NEXT_TILE);
  idiomatic(m);
  m.mem.write8(NEXT_TILE, before); // BUG: leave the ahead-tile scratch un-cleared
}

test("TEETH (ahead scratch): a twin that skips clearing the ahead-tile scratch is CAUGHT at NEXT_TILE", () => {
  const [base] = captureStates(1, 1, 300);
  // Goal path so nothing rewrites NEXT_TILE after the clear; pre-set it non-zero so the clear is observable.
  const { e } = craft(base, { objY: 3, objX: 5, underTile: 0x30, aheadTile: GOAL_TILE });
  e.mem.write8(NEXT_TILE, 0x55);

  const d = ramDiff(e, twinNoAheadClear);
  assert.notEqual(d, null, "the gate FAILED to catch an un-cleared ahead scratch — it proves nothing");
  assert.equal(d.addr, NEXT_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(NEXT_TILE)})`);
  assert.equal(ramDiff(e, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/ahead: un-cleared ahead scratch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 7. TEETH (cell column): a corrupted published tile column is CAUGHT --------------------------

/** Broken twin: does the real work, then corrupts the published tile column. */
function twinCorruptCellColumn(m) {
  idiomatic(m);
  m.mem.write8(PLAYER_TILE_COL, m.mem.read8(PLAYER_TILE_COL) ^ 0xff); // BUG: wrong tile column
}

test("TEETH (cell column): a twin that corrupts the published tile column is CAUGHT at PLAYER_TILE_COL", () => {
  const [base] = captureStates(1, 1, 320);
  const { e } = craft(base, { objY: 3, objX: 5, underTile: 0x30, aheadTile: GOAL_TILE });

  const d = ramDiff(e, twinCorruptCellColumn);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted tile column — it proves nothing");
  assert.equal(d.addr, PLAYER_TILE_COL, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_TILE_COL)})`);
  assert.equal(ramDiff(e, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/column: corrupted tile column caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
