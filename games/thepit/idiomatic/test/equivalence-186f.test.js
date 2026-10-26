// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for resolveObjectTile (ROM 0x186f) — locate the tracked object's tile cell,
 * read the tile under it, and hand the object to the matching per-frame handler.
 *
 * From the object's position counters (plus the caller's horizontal bias) it derives the row
 * and column cell coordinates, the video-RAM cell address, and the tile sitting there, publishes
 * them, then routes: the goal tile past the crossing position -> the walk-forward continuation
 * (advanceActorWalk); everything else -> the loot/dig collector (collectLootTile). Its declared
 * LIVE-OUT is MEMORY-ONLY (the cell coordinates + address, the published under-tile and cleared
 * next-tile slot, the goal latches, and whatever the handoff handler writes). Both handlers are
 * already idiomatic, so resolveObjectTile calls them directly — no register hand-off survives.
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE resolveObjectTile, whose tail-jumps
 * thread through the stack (m.call/push16), against the stack-free idiomatic handler chain. The
 * two therefore leave different dead bytes just below the entry stack pointer (The Pit's stack
 * is real diffed work RAM, ~0x83fd here) — classic dead scratch, overwritten by the caller's
 * next push before anything reads it. The diff excludes exactly that [SP-N, SP) window and
 * compares everything else byte-for-byte; the real outputs all sit far below the stack
 * (0x8020..0x80e7 plus video RAM), so the window can never hide one — the teeth confirm it.
 *
 * Registers/flags/pc/SP are excluded (the honest-signature contract): the idiomatic layer does
 * not preserve the Z80 register/step trace, and the horizontal bias — resolveObjectTile's one genuine
 * register live-in — is surfaced as the columnBias parameter (defaulting to the register, so a
 * no-arg call reproduces the oracle exactly).
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured attract entry; proves the
 *      capture/clone/replay harness reaches 0x186f in a real run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state outside
 *      the stack scratch. Attract takes the ordinary-tile path into the collector.
 *   2. EQUAL (crafted goal tile, past crossing) — force the under-tile to the goal tile with the
 *      position past the crossing point: both latch the goal + crossing and route to the
 *      walk-forward continuation, identical.
 *   3. EQUAL (crafted goal tile, before crossing) — goal tile but short of the crossing point:
 *      both latch the goal and still route to the collector, identical.
 *   4. NON-VACUOUS — a real dispatch actually writes the row/column cells, the cell address, and
 *      publishes the under-tile (a no-op twin cannot pass), and agrees with the oracle.
 *   5. TEETH (row) — a twin with a wrong row cell is CAUGHT at PLAYER_TILE_ROW.
 *   6. TEETH (tile) — a twin that publishes the wrong under-tile is CAUGHT at CUR_TILE.
 *   7. TEETH (goal latch) — on a goal entry, a twin that skips the goal latch is CAUGHT at
 *      GOAL_TILE_LATCH.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-186f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_186f as oracle } from "../../translated/loc_186f.js";
import { resolveObjectTile as idiomatic } from "../resolveObjectTile.js";
import { makeMachineFactory } from "../../machine.js";
import {
  PLAYER_Y,
  PLAYER_X,
  PLAYER_TILE_ROW,
  PLAYER_TILE_COL,
  PLAYER_CELL_PTR,
  CUR_TILE,
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

const TARGET = 0x186f;
const STACK_SCRATCH = 16; // dead-scratch window below entry SP (measured max 6 bytes on the real
// attract path; 16 leaves margin for the goal arms, and no real work-RAM output lives in 0x83xx)
const GOAL_TILE = 39; // the special tile the object crosses toward (== 0x27)
const CROSSING_POSITION = 83; // horizontal position at/after which the goal tile counts as crossed
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x186f in a real attract run and clone the machine at up to K real dispatches. The wrapper
 * snapshots the entry state, then runs the oracle so the host game proceeds undisturbed. The
 * movement/state dispatcher reaches it repeatedly during the attract demo.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(snapshot).runFrames(maxFrames);
  return caps;
}

/**
 * First differing state byte between two machines, EXCLUDING the dead stack scratch the oracle's
 * stack-threaded tail parks just below the entry stack pointer (which the stack-free idiomatic
 * handler chain does not reproduce). Null when otherwise identical.
 */
function stateDiffOutsideStack(a, b, entrySP) {
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

/** Run oracle and candidate on independent clones of `entry`; return the first differing state
 *  byte outside the stack scratch (or null). The idiomatic bias defaults to the register, so a
 *  no-arg call matches the oracle's read of it. */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

/** Replicate resolveObjectTile's cell geometry so a crafted entry can poke the exact video-RAM cell the
 *  routine will read. Guarded by an assertion that the goal arm was actually taken. */
function cellFor(objX, objY, bias) {
  const row = 31 - (((objX + 3) & 0xff) >> 3);
  const col = ((objY + bias + 12) & 0xff) >> 3;
  return 0x9000 + row * 32 + col;
}

/** Craft a goal-tile entry from a real capture: set the horizontal position, then stamp the goal
 *  tile into the exact cell the routine reads. Both arms then see the goal tile there. */
function craftGoalEntry(base, objYVal) {
  const e = base.clone();
  e.mem.write8(PLAYER_X, objYVal);
  const cell = cellFor(e.mem.read8(PLAYER_Y), objYVal, e.regs.d);
  e.mem.write8(cell, GOAL_TILE);
  return { entry: e, cell };
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x186f in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 3000);
  assert.ok(entry, "expected at least one real 0x186f dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x186f dispatch (SP=${hx(entry.regs.sp)}, ` +
      `bias D=${entry.regs.d}); oracle vs oracle -> EQUAL`,
  );
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: resolveObjectTile leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(600, 3000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (outside stack scratch)`);
});

// -- 2. EQUAL crafted: goal tile, past the crossing -> walk-forward continuation --

test("EQUAL (crafted goal tile, past crossing): both latch goal+crossing and route to the continuation", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft the goal entry from");
  const { entry, cell } = craftGoalEntry(base, CROSSING_POSITION + 8); // past the crossing point

  // Confirm the craft actually drives the goal arm on the oracle, then compare.
  const probe = entry.clone();
  oracle(probe);
  assert.equal(probe.mem.read8(cell) !== undefined && probe.mem.read8(GOAL_TILE_LATCH), GOAL_TILE, "craft did not reach the goal tile");
  assert.equal(probe.mem.read8(PIT_CROSS_ACTIVE), CROSSING_POSITION + 8, "oracle did not record the crossing position");

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), GOAL_TILE, "idiomatic did not latch the goal tile");
  assert.equal(c.mem.read8(PIT_CROSS_ACTIVE), CROSSING_POSITION + 8, "idiomatic did not record the crossing");
  console.log(`  EQUAL/goal-past: goal latched, crossing=${CROSSING_POSITION + 8}, routed to the continuation; identical to the oracle`);
});

// -- 3. EQUAL crafted: goal tile, before the crossing -> still the collector --

test("EQUAL (crafted goal tile, before crossing): both latch the goal but still route to the collector", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft the goal entry from");
  const { entry } = craftGoalEntry(base, CROSSING_POSITION - 8); // short of the crossing point

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), GOAL_TILE, "idiomatic did not latch the goal tile");
  console.log("  EQUAL/goal-before: goal latched, still routed to the collector; identical to the oracle");
});

// -- 4. NON-VACUOUS: a real dispatch actually produces its cell/tile outputs --

test("NON-VACUOUS: a real dispatch writes the row/column cells, the cell address, and the under-tile", () => {
  const [entry] = captureDispatches(1, 3000);
  assert.ok(entry, "need a real capture");

  const c = entry.clone();
  idiomatic(c);

  const objX = entry.mem.read8(PLAYER_Y);
  const objY = entry.mem.read8(PLAYER_X);
  const bias = entry.regs.d;
  const expectedRow = 31 - (((objX + 3) & 0xff) >> 3);
  const expectedCol = ((objY + bias + 12) & 0xff) >> 3;
  const expectedCell = 0x9000 + expectedRow * 32 + expectedCol;

  // These four are resolveObjectTile's own stable outputs — the downstream handoff handler never rewrites
  // them, so they hold exactly what the geometry computed (a no-op twin could not produce them).
  // (The published under-tile CUR_TILE is a real output too, but the collector may overwrite it
  // downstream, so its liveness is covered by the TEETH/tile check instead.)
  assert.equal(c.mem.read8(PLAYER_TILE_ROW), expectedRow, "row cell not written");
  assert.equal(c.mem.read8(PLAYER_TILE_COL), expectedCol, "column cell not written");
  assert.equal(c.mem.read16(PLAYER_CELL_PTR), expectedCell, "cell address not written");
  assert.equal(c.mem.read8(NEXT_TILE), 0, "next-tile slot not cleared");

  assert.equal(stateDiff(entry, idiomatic), null, "the dispatch must also match the oracle");
  console.log(`  NON-VACUOUS: row=${expectedRow} col=${expectedCol} cell=${hx(expectedCell)}; arms agree`);
});

// -- 5. TEETH (row): a wrong row cell is CAUGHT ------------------------------

/** Broken twin: does the real work, then corrupts the stored row cell. */
function twinWrongRow(m) {
  idiomatic(m);
  m.mem.write8(PLAYER_TILE_ROW, m.mem.read8(PLAYER_TILE_ROW) ^ 0xff);
}

test("TEETH (row): a twin with a wrong row cell is CAUGHT at PLAYER_TILE_ROW", () => {
  const [entry] = captureDispatches(1, 3000);
  const d = stateDiff(entry, twinWrongRow);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong row cell — it proves nothing");
  assert.equal(d.addr, PLAYER_TILE_ROW, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_TILE_ROW)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/row: wrong-row twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 6. TEETH (tile): a wrong published under-tile is CAUGHT ------------------

/** Broken twin: does the real work, then corrupts the published under-tile. */
function twinWrongTile(m) {
  idiomatic(m);
  m.mem.write8(CUR_TILE, m.mem.read8(CUR_TILE) ^ 0xff);
}

test("TEETH (tile): a twin that publishes the wrong under-tile is CAUGHT at CUR_TILE", () => {
  const [entry] = captureDispatches(1, 3000);
  const d = stateDiff(entry, twinWrongTile);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong under-tile — it proves nothing");
  assert.equal(d.addr, CUR_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(CUR_TILE)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/tile: wrong-tile twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 7. TEETH (goal latch): a skipped goal latch is CAUGHT -------------------

/** Broken twin: does the real work, then reverts the goal latch. */
function makeTwinSkipGoalLatch(before) {
  return (m) => {
    idiomatic(m);
    m.mem.write8(GOAL_TILE_LATCH, before);
  };
}

test("TEETH (goal latch): on a goal entry, a twin that skips the goal latch is CAUGHT at GOAL_TILE_LATCH", () => {
  const [base] = captureDispatches(1, 3000);
  const { entry } = craftGoalEntry(base, CROSSING_POSITION + 8);
  const before = entry.mem.read8(GOAL_TILE_LATCH);
  assert.notEqual(before, GOAL_TILE, "precondition: the goal latch must start un-set for this teeth check");

  const d = stateDiff(entry, makeTwinSkipGoalLatch(before));
  assert.notEqual(d, null, "the gate FAILED to catch a skipped goal latch — it proves nothing");
  assert.equal(d.addr, GOAL_TILE_LATCH, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(GOAL_TILE_LATCH)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/goal: skipped-latch twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
