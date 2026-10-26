// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0cc6 (ROM 0x0CC6) — the shared tail every board-setup arm
 * converges on: walk the DE-selected layout table (loc_0da7), stamp the eight rivet
 * cells on the 100m board only (stampRivetBoardTiles, guarded by BOARD == 4), then run
 * the board-setup prelude+continuation (loc_3fa0).
 *
 * loc_0cc6 WRITES memory through all three callees and the continuation carries state,
 * so it is gated by clone / replay with a FRESH clone per case. The memory-equivalence
 * contract is RAM − the stack scratch below the entry SP: the oracle's push/call/ret traffic lands in the dead
 * stack region, which the compare excludes; the direct-call layer drops it entirely.
 *
 * Attract builds 25m ONLY, so it dispatches 0x0CC6 with BOARD == 1 — the rivet gate
 * CLOSED, and the record walk covering every 25m segment. That one real entry validates
 * the glue on the gate-closed path; the gate-OPEN arm (BOARD 4) and the 50m/75m
 * continuation arms are reached by a Karl-sanctioned BOARD poke (2/3/4) applied
 * identically on both sides of the real entry.
 *
 *   1. STRUCTURE — real board-1 entry: game-visible RAM identical, and the oracle
 *      actually ran the continuation (SUBSTATE_TIMER armed to 0x40, GAME_SUBSTATE
 *      advanced). stackDiffs > 0 proves the exclusion is load-bearing; entry SP is in
 *      STACK_SCRATCH.
 *   2. BOARDS (crafted) — BOARD poked to 1/2/3/4 identically both sides: RAM − STACK
 *      identical per board, plus the observable rivet stamp on the oracle side when the
 *      gate opens (board 4: 0x76CA/0x76CB become 0xB8/0xB7).
 *   3. TEETH — four twins over loc_0cc6's three jobs and the rivet gate's BOTH
 *      directions: (a) skip the layout walk (caught in the drawn tilemap); (b) stamp
 *      the rivets UNCONDITIONALLY (caught on board 1, where the gate must stay closed);
 *      (c) skip the rivet stamp (caught on board 4, where the gate must fire); (d) skip
 *      the continuation (caught with the setup timer unarmed).
 *   4. REALISM — hook 0x0CC6 over a long attract run and replay every real dispatch;
 *      each RAM − STACK identical to the oracle.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0cc6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cc6 as oracle } from "../../translated/loc_0cc6.js";
import { loc_0cc6 as idiomatic } from "../loc_0cc6.js";
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js";
import { stampRivetBoardTiles } from "../stampRivetBoardTiles.js";
import { loc_3fa0 } from "../loc_3fa0.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, GAME_SUBSTATE, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0cc6;
// The first rivet-decoration cell pair the board-4 stamp writes (0xB8 then 0xB7).
const RIVET_CELL = 0x76ca;
// All 16 rivet-decoration bytes (8 dest cells + their +1), for the gate teeth: the
// first cell that differs depends on address order, so membership is the right check.
const RIVET_DESTS = [0x76ca, 0x76cf, 0x76d4, 0x76d9, 0x752a, 0x752f, 0x7534, 0x7539];
const RIVET_CELLS = new Set(RIVET_DESTS.flatMap((d) => [d, (d + 1) & 0xffff]));
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Hook 0x0CC6 over an attract run and clone the machine at up to K real dispatches. */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  assert.equal(host.stoppedBy, null, "attract capture run must reach the vblank spin cleanly");
  return caps;
}

// The single real board-1 dispatch attract produces, captured once and reused as the
// base for every crafted entry (cloned per case, never mutated — this routine writes RAM).
let _base = null;
function base() {
  if (!_base) {
    const caps = captureEntries(1, 2600);
    assert.ok(caps.length >= 1, "attract must dispatch 0x0CC6 at least once (25m board build)");
    _base = caps[0];
  }
  return _base;
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: real board-1 entry — game-visible RAM identical; oracle ran the continuation", () => {
  const entry = base();
  assert.equal(entry.mem.read8(BOARD), 1, "the real attract dispatch is the 25m board build (BOARD == 1)");
  assert.ok(inStack(entry.regs.sp), `entry SP must sit in STACK_SCRATCH for the exclusion to be sound (SP=${hx(entry.regs.sp)})`);

  const subBefore = entry.mem.read8(GAME_SUBSTATE);
  const a = entry.clone(), b = entry.clone();
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);

  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Non-vacuous: the continuation's salient writes are present on the oracle side.
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0x40, "oracle must arm SUBSTATE_TIMER (0x6009) = 0x40");
  assert.equal(a.mem.read8(GAME_SUBSTATE), (subBefore + 1) & 0xff, "oracle must advance GAME_SUBSTATE (0x600A)");
  assert.ok(stackDiffs > 0, "the oracle's stack traffic must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  console.log(`  STRUCTURE: RAM − STACK identical; walk+continuation executed (stackDiffs=${stackDiffs})`);
});

// -- 2. BOARDS (crafted) ------------------------------------------------------

test("BOARDS (crafted): loc_0cc6 == oracle for BOARD 1/2/3/4; the rivet stamp shows on board 4", () => {
  for (const board of [1, 2, 3, 4]) {
    const a = base().clone(), b = base().clone();
    const aFloor = a.regs.sp;
    a.mem.write8(BOARD, board);
    b.mem.write8(BOARD, board);
    oracle(a);
    idiomatic(b);

    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `BOARD ${board}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

    // Non-vacuous: the rivet gate opens only on the 100m board, where the first
    // decoration cell pair is stamped (0xB8/0xB7) and survives the continuation.
    if (board === 4) {
      assert.equal(a.mem.read8(RIVET_CELL), 0xb8, "100m: first rivet cell stamped 0xB8");
      assert.equal(a.mem.read8(RIVET_CELL + 1), 0xb7, "100m: first rivet cell pair stamped 0xB7");
    }
  }
  console.log("  BOARDS/crafted: 1/2/3/4 identical to the oracle; rivet stamp observed on board 4");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): drops the layout walk — the board's girder/ladder tiles are never drawn. */
function brokenSkipWalk(m) {
  if (m.mem.read8(BOARD) === 0x04) stampRivetBoardTiles(m);
  loc_3fa0(m);
}

/** Twin (b): stamps the rivet cells UNCONDITIONALLY, ignoring the BOARD == 4 gate. */
function brokenAlwaysStamp(m) {
  loc_0da7(m);
  stampRivetBoardTiles(m); // BUG: no BOARD == 4 guard
  loc_3fa0(m);
}

/** Twin (c): never stamps the rivet cells, even on the 100m board. */
function brokenSkipRivet(m) {
  loc_0da7(m);
  // BUG: missing the BOARD == 4 rivet stamp
  loc_3fa0(m);
}

/** Twin (d): drops the board-setup continuation, running only the walk (+ rivet gate). */
function brokenSkipContinuation(m) {
  loc_0da7(m);
  if (m.mem.read8(BOARD) === 0x04) stampRivetBoardTiles(m);
}

test("TEETH (skip-walk): dropping the layout walk is CAUGHT in the drawn tilemap", () => {
  const a = base().clone(), b = base().clone(); // board 1 (attract's natural), gate closed
  const aFloor = a.regs.sp;
  oracle(a);
  brokenSkipWalk(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a dropped layout walk — it is worthless");
  assert.equal(inStack(bad.addr), false, "the caught diff must be game-visible, not stack scratch");
  console.log(`  TEETH/skip-walk: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (always-stamp): the rivet gate open on board 1 is CAUGHT at the rivet cell", () => {
  const a = base().clone(), b = base().clone(); // board 1: gate MUST stay closed
  const aFloor = a.regs.sp;
  assert.equal(a.mem.read8(BOARD), 1, "this twin is validated on board 1 (gate closed)");
  oracle(a);
  brokenAlwaysStamp(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch an ungated rivet stamp — it is worthless");
  assert.ok(RIVET_CELLS.has(bad.addr), `expected the caught diff at a rivet cell, got ${hx(bad.addr)}`);
  console.log(`  TEETH/always-stamp: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (skip-rivet): the rivet gate closed on board 4 is CAUGHT at the rivet cell", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  a.mem.write8(BOARD, 4); // the 100m board, where the gate MUST fire
  b.mem.write8(BOARD, 4);
  oracle(a);
  brokenSkipRivet(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a skipped rivet stamp — it is worthless");
  assert.ok(RIVET_CELLS.has(bad.addr), `expected the caught diff at a rivet cell, got ${hx(bad.addr)}`);
  console.log(`  TEETH/skip-rivet: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (skip-continuation): dropping the continuation is CAUGHT with the setup timer unarmed", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  oracle(a);
  brokenSkipContinuation(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a dropped board-setup continuation — it is worthless");
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0x40, "oracle arms the setup timer");
  assert.notEqual(b.mem.read8(SUBSTATE_TIMER), 0x40, "the twin (no continuation) must leave the setup timer unarmed");
  console.log(`  TEETH/skip-continuation: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 4. REALISM ---------------------------------------------------------------

test("REALISM: replay every real 0x0cc6 dispatch — game-visible RAM identical to the oracle", () => {
  const caps = captureEntries(16, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0cc6 dispatch in a long attract run");
  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0cc6 dispatch(es) — game-visible RAM identical to the oracle`);
});
