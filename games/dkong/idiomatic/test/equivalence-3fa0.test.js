// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_3fa0 (ROM 0x3FA0) — the board-setup prelude: stamp the
 * 50m-only tiles (stamp50mBoardTiles), then run the board-setup continuation
 * (loc_0d5f).
 *
 * The routine WRITES memory through both callees and the continuation has state, so
 * it is gated by clone / replay with a FRESH clone per case. The memory-equivalence
 * contract is RAM − the stack scratch below the entry SP: the oracle's return-address and call-chain stack
 * traffic lands in the dead stack region, which the compare excludes; the direct-call
 * layer drops it entirely.
 *
 * Attract sets up 25m ONLY, so it dispatches 0x3FA0 with BOARD == 1, where the 50m
 * applicability gate is CLOSED (no tile writes) and only the continuation runs. That
 * one real entry validates the glue on the gate-closed path; the gate-OPEN arm and
 * the other continuation arms are reached by a Karl-sanctioned BOARD poke (2/3/4)
 * applied identically on both sides of the real entry.
 *
 *   1. STRUCTURE — on the real board-1 entry, game-visible RAM (RAM − the stack scratch below the entry SP)
 *      is identical, and the oracle actually did the continuation work (SUBSTATE_TIMER
 *      armed to 0x40, GAME_SUBSTATE advanced). stackDiffs > 0 proves the exclusion is
 *      load-bearing, and the entry SP sits in STACK_SCRATCH.
 *
 *   2. BOARDS (crafted) — BOARD poked to 1/2/3/4 identically on both sides: RAM − STACK
 *      identical per board, plus the observable 50m stamp on the oracle side when the
 *      gate opens (board 2: the four cells become 0x10/0xC0/0x10/0xC0).
 *
 *   3. TEETH — two twins targeting loc_3fa0's two jobs: (a) skipping the tile stamp,
 *      caught on the 50m board at one of the stamp cells; (b) skipping the
 *      continuation, caught with the setup timer left unarmed.
 *
 *   4. REALISM — hook 0x3FA0 over a long attract run and replay every real dispatch;
 *      at least one occurs (25m board build), each RAM − STACK identical to the oracle.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3fa0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3fa0 as oracle } from "../../translated/loc_3fa0.js";
import { loc_3fa0 as idiomatic } from "../loc_3fa0.js";
import { stamp50mBoardTiles } from "../stamp50mBoardTiles.js";
import { loc_0d5f } from "../loc_0d5f.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, GAME_SUBSTATE, BOARD } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3fa0;
// The four video-RAM tilemap cells the 50m stamp writes on the gate-open board.
const STAMP_CELLS = [0x776c, 0x776e, 0x748c, 0x748e];
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

/** Hook 0x3FA0 over an attract run and clone the machine at up to K real dispatches. */
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
    assert.ok(caps.length >= 1, "attract must dispatch 0x3FA0 at least once (25m board build)");
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
  console.log(`  STRUCTURE: RAM − STACK identical; continuation timer/substate executed (stackDiffs=${stackDiffs})`);
});

// -- 2. BOARDS (crafted) ------------------------------------------------------

test("BOARDS (crafted): loc_3fa0 == oracle for BOARD 1/2/3/4; the 50m stamp shows on board 2", () => {
  for (const board of [1, 2, 3, 4]) {
    const a = base().clone(), b = base().clone();
    const aFloor = a.regs.sp;
    a.mem.write8(BOARD, board);
    b.mem.write8(BOARD, board);
    oracle(a);
    idiomatic(b);

    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `BOARD ${board}: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

    // Non-vacuous: the applicability gate opens only on the 50m board, where the four
    // fixed cells are stamped (0x10/0xC0 pairs) and survive the continuation.
    if (board === 2) {
      assert.equal(a.mem.read8(0x776c), 0x10, "50m: first cell stamped 0x10");
      assert.equal(a.mem.read8(0x776e), 0xc0, "50m: first cell pair stamped 0xC0");
      assert.equal(a.mem.read8(0x748c), 0x10, "50m: second cell stamped 0x10");
      assert.equal(a.mem.read8(0x748e), 0xc0, "50m: second cell pair stamped 0xC0");
    }
  }
  console.log("  BOARDS/crafted: 1/2/3/4 identical to the oracle; 50m stamp observed on board 2");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): drops the 50m tile stamp, running only the continuation. On the 50m
 *  board the four stamped cells are then missing, so the diff lands on a stamp cell. */
function brokenSkipStamp(m) {
  loc_0d5f(m);
}

/** Twin (b): drops the continuation, running only the tile stamp. All the continuation
 *  work is then missing, most simply the armed setup timer. */
function brokenSkipContinuation(m) {
  stamp50mBoardTiles(m);
}

test("TEETH (skip-stamp): dropping the 50m tile stamp is CAUGHT at a stamp cell", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  a.mem.write8(BOARD, 2); // the 50m board, where the gate opens and the stamp is live
  b.mem.write8(BOARD, 2);
  oracle(a);
  brokenSkipStamp(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a dropped 50m tile stamp — it is worthless");
  assert.ok(STAMP_CELLS.includes(bad.addr), `expected the caught diff at a stamp cell, got ${hx(bad.addr)}`);
  console.log(`  TEETH/skip-stamp: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
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

test("REALISM: replay every real 0x3fa0 dispatch — game-visible RAM identical to the oracle", () => {
  const caps = captureEntries(16, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x3fa0 dispatch in a long attract run");
  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  console.log(`  REALISM: ${caps.length} real 0x3fa0 dispatch(es) — game-visible RAM identical to the oracle`);
});
