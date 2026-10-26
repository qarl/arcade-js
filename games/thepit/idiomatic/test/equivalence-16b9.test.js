// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for locateActorCellCheckGoal (ROM 0x16b9) — route a moving actor's horizontal step:
 * if it has reached the goal terminator tile, latch the goal crossing and walk it on; otherwise
 * resolve the terrain step it is entering.
 *
 * Given the actor's tile row (register live-in, surfaced as `row`) and its sprite/state code
 * (surfaced as `spriteCode`), it locates the tilemap cell under the actor, publishes the tile
 * column (PLAYER_TILE_COL) and the cell pointer (PLAYER_CELL_PTR), and either latches the goal
 * crossing (GOAL_TILE_LATCH + PIT_CROSS_ACTIVE) and hands off to advanceActorWalk, or hands
 * the step to the terrain-collision handler resolveActorTerrainStep. Both callees are already idiomatic, so
 * locateActorCellCheckGoal calls them directly with honest args (cell pointer + biased column); no register
 * hand-off survives. Its declared LIVE-OUT is MEMORY-ONLY.
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE locateActorCellCheckGoal, whose tail-jumps
 * thread through the Z80 stack (m.call, and, on the terrain handler's collect paths, register
 * saves), against the stack-free idiomatic handoff chain. Any dead bytes the oracle parks just
 * below the entry stack pointer (The Pit's stack is real diffed work RAM, entry SP 0x83fd here)
 * are classic scratch — overwritten by the caller's next push before anything reads them. The
 * diff excludes exactly that [SP-N, SP) window and compares everything else byte-for-byte; every
 * real output sits far below (0x806e..0x80e7 plus video RAM), so the window can never hide one —
 * the teeth confirm it. Registers/flags/pc/SP are excluded (the honest-signature contract); the
 * two register live-ins default to the registers so a no-arg call reproduces the oracle exactly.
 *
 * Attract only ever reaches the terrain-step path (the goal latch stays clear and no goal tile is
 * ever peeked), so real captured dispatches drive that arm and CRAFTED entries drive the goal
 * arms attract never produces: a goal tile poked into the cell one step ahead, into the cell one
 * full row further down, and the already-at-terminator short-circuit (latch set + sprite 0x17).
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured attract dispatch; proves the
 *      capture/clone/replay harness reaches 0x16b9 in a real run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state outside
 *      the stack scratch (the terrain-step routing).
 *   2. NON-VACUOUS — a real dispatch actually publishes the computed tile column and cell pointer
 *      and routes to the terrain handler (the latch stays clear); a no-op twin cannot pass.
 *   3. EQUAL (crafted goal ahead) — a goal tile in the cell one step ahead latches the crossing
 *      and advances the walk, identical to the oracle.
 *   4. EQUAL (crafted goal one row down) — the same for the cell one full row further down.
 *   5. EQUAL (crafted head short-circuit) — latch set + sprite 0x17 latches the sprite code and
 *      advances, identical to the oracle.
 *   6. TEETH (cell pointer) — a twin that corrupts the published cell pointer is CAUGHT at
 *      PLAYER_CELL_PTR.
 *   7. TEETH (goal latch) — on a crafted goal entry, a twin that skips the goal latch is CAUGHT at
 *      GOAL_TILE_LATCH.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-16b9.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16b9 as oracle } from "../../translated/loc_16b9.js";
import { locateActorCellCheckGoal as idiomatic } from "../locateActorCellCheckGoal.js";
import { makeMachineFactory } from "../../machine.js";
import { PLAYER_X, PLAYER_TILE_COL, PLAYER_CELL_PTR, GOAL_TILE_LATCH, PIT_CROSS_ACTIVE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x16b9;
const STACK_SCRATCH = 64; // dead bytes the oracle's stack-threaded tails may park below entry SP
// (measured 0 on the reached paths; 64 leaves ample margin and no real work-RAM output lives in 0x83xx)
const GOAL_TILE = 39; // 0x27 — the terminator/goal tile the routine watches for
const AT_TERMINATOR_SPRITE = 0x17; // sprite/state code meaning "already on the terminator"
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Hook 0x16b9 in a real attract run and clone up to K real dispatches — each a genuine in-play
 * state for the horizontal-step router. The wrapper snapshots then runs the oracle so attract
 * proceeds undisturbed. The dispatch reaches it repeatedly during the demo.
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
 * stack-threaded tails may park just below the entry stack pointer (which the stack-free idiomatic
 * handoff chain does not reproduce). Null when otherwise identical.
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
 *  byte outside the stack scratch (or null). The idiomatic live-ins default to the registers, so
 *  a no-arg call matches the oracle exactly. */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

/** The tile column + cell pointer locateActorCellCheckGoal computes for an entry (mirrors the routine's geometry:
 *  bias the column by 5, top bits = tile column, fold with the row into the tilemap address). */
function expectedCell(entry) {
  const biased = (entry.mem.read8(PLAYER_X) + 5) & 0xff;
  const tileColumn = biased >> 3;
  return { tileColumn, cellPtr: 0x9000 + entry.regs.h * 32 + tileColumn };
}

/** A real dispatch clone with the goal tile poked into a peeked cell (offset +1 or +33 from the
 *  cell pointer), forcing the goal-reached arm attract never produces. */
function craftGoal(base, cellOffset) {
  const e = base.clone();
  const { cellPtr } = expectedCell(e);
  e.mem.write8(cellPtr + cellOffset, GOAL_TILE);
  return e;
}

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x16b9 in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 4000);
  assert.ok(entry, "expected at least one real 0x16b9 dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x16b9 dispatch (SP=${hx(entry.regs.sp)}, row=${hx(entry.regs.h)}, ` +
      `L=${hx(entry.regs.l)}); oracle vs oracle -> EQUAL`,
  );
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: locateActorCellCheckGoal leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(500, 4000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");
  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (terrain-step routing)`);
});

// -- 2. NON-VACUOUS: the cell geometry is really published + routed to terrain ----

test("NON-VACUOUS: a real dispatch publishes the computed tile column + cell pointer and routes to terrain", () => {
  const [entry] = captureDispatches(1, 4000);
  assert.ok(entry, "need a real capture");
  const { tileColumn, cellPtr } = expectedCell(entry);
  assert.equal(entry.mem.read8(GOAL_TILE_LATCH), 0, "precondition: attract keeps the goal latch clear");

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(PLAYER_TILE_COL), tileColumn, "the tile column was not published");
  assert.equal(c.mem.read16(PLAYER_CELL_PTR), cellPtr, "the cell pointer was not published");
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), 0, "the terrain path must not touch the goal latch");

  assert.equal(stateDiff(entry, idiomatic), null, "the entry must also match the oracle");
  console.log(`  NON-VACUOUS: tile column=${tileColumn}, cell pointer=${hx(cellPtr)}, latch clear (terrain routing)`);
});

// -- 2b. EQUAL across the column-wrap boundary -------------------------------

test("EQUAL (column wrap): a column position whose +5 bias overflows a byte still matches the oracle", () => {
  const caps = captureDispatches(1, 4000);
  const base = caps[0];
  assert.ok(base, "need a real capture");
  // Column positions 251..255 push the +5 bias past a byte, exercising the tile-column reduction
  // right at the wrap the routine's byte-width bias handles.
  for (let col = 250; col < 256; col++) {
    const entry = base.clone();
    entry.mem.write8(PLAYER_X, col);
    const d = stateDiff(entry, idiomatic);
    assert.equal(d, null, d && `col=${col}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log("  EQUAL/column-wrap: positions 250..255 (bias overflows a byte) identical to the oracle");
});

// -- 3. EQUAL on a crafted goal-ahead entry ----------------------------------

test("EQUAL (crafted goal ahead): a goal tile one step ahead latches the crossing + advances, identical to the oracle", () => {
  const caps = captureDispatches(50, 4000);
  const base = caps.find((c) => c.mem.read8(GOAL_TILE_LATCH) === 0);
  assert.ok(base, "need a real capture with the latch clear");
  const entry = craftGoal(base, 1); // goal tile in the cell one step ahead

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), GOAL_TILE, "goal latch not set to the matched tile");
  assert.equal(c.mem.read8(PIT_CROSS_ACTIVE), GOAL_TILE, "goal crossing latch not set");
  console.log(`  EQUAL/goal-ahead: crossing latched (${hx(GOAL_TILE)}) + walk advanced; identical to the oracle`);
});

// -- 4. EQUAL on a crafted goal-one-row-down entry ---------------------------

test("EQUAL (crafted goal one row down): a goal tile one full row further down latches + advances, identical to the oracle", () => {
  const caps = captureDispatches(50, 4000);
  const base = caps.find((c) => c.mem.read8(GOAL_TILE_LATCH) === 0);
  assert.ok(base, "need a real capture with the latch clear");
  const entry = craftGoal(base, 1 + 32); // goal tile in the cell one step ahead, one row down

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), GOAL_TILE, "goal latch not set from the row-down cell");
  console.log("  EQUAL/goal-row-down: crossing latched from the one-row-down cell; identical to the oracle");
});

// -- 5. EQUAL on the crafted head short-circuit ------------------------------

test("EQUAL (crafted head short-circuit): latch set + sprite 0x17 latches the sprite code + advances, identical to the oracle", () => {
  const caps = captureDispatches(50, 4000);
  const base = caps.find((c) => c.mem.read8(GOAL_TILE_LATCH) === 0);
  assert.ok(base, "need a real capture to craft from");
  const entry = base.clone();
  entry.mem.write8(GOAL_TILE_LATCH, 0x99); // latch already set (any nonzero value)
  entry.regs.l = AT_TERMINATOR_SPRITE; // sprite says "already on the terminator"

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(GOAL_TILE_LATCH), AT_TERMINATOR_SPRITE, "goal latch not overwritten with the sprite code");
  assert.equal(c.mem.read8(PIT_CROSS_ACTIVE), AT_TERMINATOR_SPRITE, "goal crossing latch not set to the sprite code");
  console.log(`  EQUAL/head-short: sprite code ${hx(AT_TERMINATOR_SPRITE)} latched into both latches; identical to the oracle`);
});

// -- 6. TEETH (cell pointer): a corrupted cell pointer is CAUGHT --------------

/** Broken twin: does the real work, then corrupts the published cell pointer. */
function twinBadCellPtr(m) {
  idiomatic(m);
  m.mem.write16(PLAYER_CELL_PTR, m.mem.read16(PLAYER_CELL_PTR) ^ 0xffff);
}

test("TEETH (cell pointer): a twin that corrupts the published cell pointer is CAUGHT at PLAYER_CELL_PTR", () => {
  const [entry] = captureDispatches(1, 4000);
  assert.ok(entry, "need a real capture");

  const d = stateDiff(entry, twinBadCellPtr);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted cell pointer — it proves nothing");
  assert.equal(d.addr, PLAYER_CELL_PTR, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_CELL_PTR)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/cell-ptr: corrupted-pointer twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 7. TEETH (goal latch): a skipped goal latch is CAUGHT -------------------

/** Broken twin: does the real work, then reverts the goal latch (drops the goal detection). */
function makeTwinNoGoalLatch(before) {
  return (m) => {
    idiomatic(m);
    m.mem.write8(GOAL_TILE_LATCH, before);
  };
}

test("TEETH (goal latch): on a crafted goal entry, a twin that skips the goal latch is CAUGHT at GOAL_TILE_LATCH", () => {
  const caps = captureDispatches(50, 4000);
  const base = caps.find((c) => c.mem.read8(GOAL_TILE_LATCH) === 0);
  assert.ok(base, "need a real capture with the latch clear");
  const entry = craftGoal(base, 1);
  const before = entry.mem.read8(GOAL_TILE_LATCH);
  assert.notEqual(before, GOAL_TILE, "precondition: the latch must start un-set for this teeth check");

  const d = stateDiff(entry, makeTwinNoGoalLatch(before));
  assert.notEqual(d, null, "the gate FAILED to catch a skipped goal latch — it proves nothing");
  assert.equal(d.addr, GOAL_TILE_LATCH, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(GOAL_TILE_LATCH)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/goal-latch: skipped-latch twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
