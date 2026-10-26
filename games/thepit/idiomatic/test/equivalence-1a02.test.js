// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stepObjectAndResolveTile (ROM 0x1a02) — step the tracked object one frame along
 * its climb axis and resolve the tile it lands on (collect loot / carve / block / keep moving).
 *
 * From the object's position counters (plus the caller's column bias) it derives the tile cell,
 * publishes the under-tile, and resolves it: loot on a boundary is scored + blanked; solid tiles
 * defer the frame; a diggable-terrain mismatch arms the carve reaction (and records a neighbour);
 * anything else advances one step and cycles the walk sprite. Its declared LIVE-OUT is
 * MEMORY-ONLY. The column bias — its one genuine register live-in — is surfaced as the columnBias
 * parameter (defaulting to the register, so a no-arg call reproduces the oracle).
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE stepObjectAndResolveTile — whose every terminal
 * threads through the stack (m.call the epilogue, and push16 + m.call the score/sound awards) —
 * against the stack-free idiomatic routine, which calls its already-idiomatic callees
 * (stageObjectSpriteRecord, awardTenPoints, awardTwentyPoints) directly. The two therefore leave
 * different dead bytes just below the entry stack pointer (The Pit's stack is real diffed work RAM,
 * ~0x83fd here) — classic dead scratch, overwritten by the caller's next push before anything
 * reads it. The diff excludes exactly that [SP-N, SP) window and compares everything else
 * byte-for-byte; every real output sits far below the stack (0x8020..0x80e7 plus video RAM), so
 * the window can never hide one — the teeth confirm it. Registers/flags/pc/SP are excluded per the
 * honest-signature contract (the idiomatic layer does not preserve the Z80 register/step trace).
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured attract entry; proves capture/replay
 *      reaches 0x1a02 in a real run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state outside the
 *      stack scratch. The demo's object is descending, so these take the keep-moving/advance arm.
 *   2. EQUAL (crafted loot) — force the boundary + a 10-point loot tile: both award, tally, blank
 *      the cell and keep moving, identical.
 *   3. EQUAL (crafted solid) — force a solid tile: both defer the frame, identical.
 *   4. EQUAL (crafted diggable sweep) — force each diggable code at an off-boundary phase: both
 *      resolve match (keep moving) vs mismatch (arm the carve reaction + neighbour lookup)
 *      identically; at least one drives the carve reaction, proving that arm is exercised.
 *   5. EQUAL (crafted top-rung) — force the top-rung column: both defer (latching the spawn flag
 *      when the second-loot latch is set), identical.
 *   6. NON-VACUOUS — a real dispatch writes the row/column cells, the cell address, the under-tile
 *      and the stepped position (a no-op twin cannot pass), and agrees with the oracle.
 *   7. TEETH (tile) — a twin that publishes the wrong under-tile is CAUGHT at CUR_TILE.
 *   8. TEETH (row) — a twin with a wrong row cell is CAUGHT at PLAYER_TILE_ROW.
 *   9. TEETH (step) — a twin with a wrong stepped position is CAUGHT at PLAYER_X.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-1a02.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a02 as oracle } from "../../translated/loc_1a02.js";
import { stepObjectAndResolveTile as idiomatic } from "../stepObjectAndResolveTile.js";
import { makeMachineFactory } from "../../machine.js";
import {
  MOVE_BLOCK_FLAG,
  PLAYER_FACING,
  PLAYER_Y,
  PLAYER_TILE_ROW,
  PLAYER_X,
  PLAYER_TILE_COL,
  BOARD_END_PHASE,
  GOAL_TILE_LATCH,
  PLAYER_CELL_PTR,
  NEXT_TILE,
  CUR_TILE,
  REACTION_STATE,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x1a02;
const STACK_SCRATCH = 32; // dead-scratch window below entry SP (the score/sound award path parks a
// few register saves here; no real work-RAM output lives in 0x83xx, so the window can hide none)
const BLANK_TILE = 112;
const SECOND_LOOT_LATCH = 0x8078; // records the collected 20-point code; gates the top-rung flag
const TOP_RUNG_COLUMN = 35;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x1a02 in a real attract run and clone the machine at up to K real dispatches. The wrapper
 * snapshots the entry state, then runs the oracle so the host game proceeds undisturbed.
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
 * stack-threaded terminals park just below the entry stack pointer (which the stack-free idiomatic
 * routine does not reproduce). Null when otherwise identical.
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

/** Replicate stepObjectAndResolveTile's cell geometry so a crafted entry can poke the exact video-RAM cell the
 *  routine will read. */
function cellFor(objX, objY, bias) {
  const row = 31 - (((objX + 3) & 0xff) >> 3);
  const col = (((objY - bias + 5) & 0xff)) >> 3;
  return 0x9000 + row * 32 + col;
}

/** An objY that lands the object ON a cell boundary (sub-cell phase 0) for the given bias, kept in
 *  the mid-column range the demo actually uses (never the top-rung 35, never below the crossing). */
function onBoundaryY(bias) {
  return (bias - 5 + 8 * 26) & 0xff; // (y - bias + 5) & 7 == 0
}
/** An objY OFF a cell boundary (sub-cell phase 3) for the given bias. */
function offBoundaryY(bias) {
  return (onBoundaryY(bias) + 3) & 0xff;
}

/** Craft an entry from a real capture: set the object's climb position, then stamp a tile into the
 *  exact cell the routine reads. Both arms then see that tile there. */
function craftTileEntry(base, objY, tile) {
  const e = base.clone();
  e.mem.write8(PLAYER_X, objY);
  const cell = cellFor(e.mem.read8(PLAYER_Y), objY, e.regs.d);
  e.mem.write8(cell, tile);
  return { entry: e, cell };
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x1a02 in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 3000);
  assert.ok(entry, "expected at least one real 0x1a02 dispatch during attract");
  assert.equal(entry.mem.read8(MOVE_BLOCK_FLAG), 0, "captured entry should have the climb gate clear");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x1a02 dispatch (SP=${hx(entry.regs.sp)}, bias D=${entry.regs.d}, ` +
      `objY=${entry.mem.read8(PLAYER_X)}); oracle vs oracle -> EQUAL`,
  );
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: stepObjectAndResolveTile leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(64, 3000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (outside stack scratch)`);
});

// -- 2. EQUAL crafted: loot on a boundary -> award + blank + keep moving ------

test("EQUAL (crafted loot): a 10-point tile on a boundary is scored, tallied, blanked; identical", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft from");
  const { entry, cell } = craftTileEntry(base, onBoundaryY(base.regs.d), 58);

  // The craft must actually drive the loot arm on the oracle (cell blanked).
  const probe = entry.clone();
  oracle(probe);
  assert.equal(probe.mem.read8(cell), BLANK_TILE, "craft did not reach the loot arm (cell not blanked)");

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(cell), BLANK_TILE, "idiomatic did not blank the collected cell");
  console.log(`  EQUAL/loot: 10-point tile collected at ${hx(cell)}, blanked, kept moving; identical to the oracle`);
});

// -- 3. EQUAL crafted: a solid tile defers the frame -------------------------

test("EQUAL (crafted solid): a solid tile defers the frame (no move), identical", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft from");
  const bias = base.regs.d;
  const objY = offBoundaryY(bias);
  const { entry } = craftTileEntry(base, objY, 42); // 42 == a hard-solid tile

  // A solid tile must NOT advance the position (the deferral path leaves PLAYER_X untouched).
  const probe = entry.clone();
  oracle(probe);
  assert.equal(probe.mem.read8(PLAYER_X), objY, "solid craft unexpectedly advanced the object");

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/solid: solid tile deferred the frame; identical to the oracle");
});

// -- 4. EQUAL crafted: the diggable band (match + carve-reaction mismatch) ----

test("EQUAL (crafted diggable sweep): every diggable code resolves identically, incl. the carve arm", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft from");
  const bias = base.regs.d;
  const objY = offBoundaryY(bias); // off a boundary -> the classify/diggable path

  let reactions = 0;
  for (let tile = 113; tile <= 157; tile++) {
    const { entry } = craftTileEntry(base, objY, tile);

    const d = stateDiff(entry, idiomatic);
    assert.equal(d, null, d && `tile ${tile}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

    const probe = entry.clone();
    oracle(probe);
    if (probe.mem.read8(REACTION_STATE) === 4) reactions++;
  }
  assert.ok(reactions > 0, "the diggable sweep never drove the carve reaction — that arm is untested");
  console.log(`  EQUAL/diggable: 45 diggable codes identical to the oracle; ${reactions} drove the carve reaction`);
});

// -- 5. EQUAL crafted: the top-rung column defers (and latches the spawn flag) --

test("EQUAL (crafted top-rung): the top-rung column defers, latching the spawn flag; identical", () => {
  const [base] = captureDispatches(1, 3000);
  assert.ok(base, "need a real capture to craft from");

  const e = base.clone();
  e.mem.write8(PLAYER_X, TOP_RUNG_COLUMN);
  e.mem.write8(SECOND_LOOT_LATCH, 3); // second-loot latch set -> the top-rung spawn flag should latch

  const probe = e.clone();
  oracle(probe);
  assert.equal(probe.mem.read8(BOARD_END_PHASE), 1, "top-rung craft did not latch the spawn flag on the oracle");

  const d = stateDiff(e, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/top-rung: top-rung column deferred + latched the spawn flag; identical to the oracle");
});

// -- 6. NON-VACUOUS: a real dispatch produces its cell/tile/step outputs ------

test("NON-VACUOUS: a real dispatch writes the row/column cells, the cell address, the under-tile, the step", () => {
  const [entry] = captureDispatches(1, 3000);
  assert.ok(entry, "need a real capture");

  const objX = entry.mem.read8(PLAYER_Y);
  const objY = entry.mem.read8(PLAYER_X);
  const bias = entry.regs.d;
  const delta = entry.mem.read8(0x806d);
  const expectedRow = 31 - (((objX + 3) & 0xff) >> 3);
  const expectedCol = (((objY - bias + 5) & 0xff)) >> 3;
  const expectedCell = 0x9000 + expectedRow * 32 + expectedCol;
  const expectedTile = entry.mem.read8(expectedCell);

  const c = entry.clone();
  idiomatic(c);

  assert.equal(c.mem.read8(PLAYER_TILE_ROW), expectedRow, "row cell not written");
  assert.equal(c.mem.read8(PLAYER_TILE_COL), expectedCol, "column cell not written");
  assert.equal(c.mem.read16(PLAYER_CELL_PTR), expectedCell, "cell address not written");
  assert.equal(c.mem.read8(CUR_TILE), expectedTile, "under-tile not published");
  assert.equal(c.mem.read8(PLAYER_X), (objY - delta) & 0xff, "object did not advance one step");

  assert.equal(stateDiff(entry, idiomatic), null, "the dispatch must also match the oracle");
  console.log(
    `  NON-VACUOUS: row=${expectedRow} col=${expectedCol} cell=${hx(expectedCell)} tile=${expectedTile}; ` +
      `stepped ${objY}->${(objY - delta) & 0xff}; arms agree`,
  );
});

// -- 7. TEETH (tile): a wrong published under-tile is CAUGHT ------------------

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

// -- 8. TEETH (row): a wrong row cell is CAUGHT ------------------------------

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

// -- 9. TEETH (step): a wrong stepped position is CAUGHT ---------------------

function twinWrongStep(m) {
  idiomatic(m);
  m.mem.write8(PLAYER_X, m.mem.read8(PLAYER_X) ^ 0xff);
}

test("TEETH (step): a twin with a wrong stepped position is CAUGHT at PLAYER_X", () => {
  const [entry] = captureDispatches(1, 3000);
  const d = stateDiff(entry, twinWrongStep);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong stepped position — it proves nothing");
  assert.equal(d.addr, PLAYER_X, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_X)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/step: wrong-step twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
