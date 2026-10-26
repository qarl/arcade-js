// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_0cd4 (ROM 0x0CD4) — the 25m board-setup arm: select the 25m
 * girder layout table, queue the 25m background tune (SND_BGM = 8), then hand off to the
 * shared board-setup tail loc_0cc6 (walk the selected table into the playfield, the
 * 100m-only rivet stamp, and the rest of board setup).
 *
 * loc_0cd4 dissolves the oracle's tail jump `jp 0x0cc6` into a DIRECT call to the already-
 * idiomatic loc_0cc6, and hands the tail its layout pointer through the register image
 * (the tail's record walk reads DE). It WRITES memory through the whole shared tail, so it
 * is gated by clone / replay with a FRESH clone per case. The memory-equivalence contract
 * is RAM − the stack scratch below the entry SP: the oracle's push/call/ret traffic lands in the dead stack
 * region, which the compare excludes; the direct-call layer drops it entirely.
 *
 * Attract builds the 25m board, so it dispatches 0x0CD4 naturally (the board-1 setup arm,
 * BOARD == 1) — a real entry that runs the tail end-to-end. There is no unreached arm to
 * craft: this routine has a single path.
 *
 *   1. STRUCTURE — real board-1 entry: game-visible RAM identical to the oracle, and the
 *      oracle actually ran the arm+tail (SND_BGM queued to 8, SUBSTATE_TIMER armed to
 *      0x40, GAME_SUBSTATE advanced). stackDiffs > 0 proves the exclusion is load-bearing;
 *      entry SP is in STACK_SCRATCH.
 *   2. TEETH — two twins over loc_0cd4's two jobs: (a) queue the WRONG tune (9 not 8),
 *      caught at the tune latch; (b) select the WRONG layout table (the 50m conveyor
 *      table), caught in the drawn tilemap after the tail walks it.
 *   3. REALISM — hook 0x0CD4 over a long attract run and replay every real dispatch; each
 *      RAM − STACK identical to the oracle.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0cd4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0cd4 as oracle } from "../../translated/loc_0cd4.js";
import { setup25mGirderBoard as idiomatic } from "../setup25mGirderBoard.js";
import { loc_0cc6 } from "../loc_0cc6.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SND_BGM, BOARD, SUBSTATE_TIMER, GAME_SUBSTATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0cd4;
const LAYOUT_25M = 0x3ae4; // the table this arm selects (the 25m girders)
const LAYOUT_50M = 0x3b5d; // the 50m conveyor table — a WRONG selection for the 25m arm
const VRAM_LO = 0x7400;    // tile-map video RAM [0x7400, 0x7800): where a wrong board draws
const VRAM_HI = 0x7800;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;
const inVram = (a) => a >= VRAM_LO && a < VRAM_HI;

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

/** Hook 0x0CD4 over an attract run and clone the machine at up to K real dispatches. */
function captureEntries(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  assert.equal(host.stoppedBy, null, "attract capture run must reach the vblank spin cleanly");
  return caps;
}

// The single real board-1 dispatch attract produces, captured once and reused as the base
// for every case (cloned per case, never mutated — this routine writes RAM).
let _base = null;
function base() {
  if (!_base) {
    const caps = captureEntries(1, 2600);
    assert.ok(caps.length >= 1, "attract must dispatch 0x0CD4 at least once (25m board build)");
    _base = caps[0];
  }
  return _base;
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: real board-1 entry — game-visible RAM identical; oracle ran the arm+tail", () => {
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

  // Non-vacuous: the arm queued its tune and the tail ran the continuation.
  assert.equal(a.mem.read8(SND_BGM), 8, "oracle must queue the 25m tune (SND_BGM = 8)");
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0x40, "oracle must arm SUBSTATE_TIMER (0x6009) = 0x40");
  assert.equal(a.mem.read8(GAME_SUBSTATE), (subBefore + 1) & 0xff, "oracle must advance GAME_SUBSTATE (0x600A)");
  assert.ok(stackDiffs > 0, "the oracle's stack traffic must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  console.log(`  STRUCTURE: RAM − STACK identical; tune queued + continuation executed (stackDiffs=${stackDiffs})`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** Twin (a): queues the WRONG background tune (9 instead of the 25m tune 8). */
function brokenWrongTune(m) {
  m.regs.de = LAYOUT_25M;
  m.mem.write8(SND_BGM, 9); // BUG: wrong tune
  loc_0cc6(m);
}

/** Twin (b): selects the WRONG layout table (the 50m conveyor table), so the shared tail
 *  draws the wrong board into the playfield. */
function brokenWrongTable(m) {
  m.regs.de = LAYOUT_50M; // BUG: the 50m table, not the 25m girders
  m.mem.write8(SND_BGM, 8);
  loc_0cc6(m);
}

test("TEETH (wrong-tune): queuing the wrong tune is CAUGHT at the tune latch", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongTune(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a wrong queued tune — it is worthless");
  assert.equal(bad.addr, SND_BGM, `expected the caught diff at the tune latch ${hx(SND_BGM)}, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-tune: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-table): selecting the wrong layout table is CAUGHT in the drawn tilemap", () => {
  const a = base().clone(), b = base().clone();
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongTable(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the gate FAILED to catch a wrong layout-table selection — it is worthless");
  assert.ok(inVram(bad.addr), `expected the caught diff in tile-map video RAM, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-table: caught at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b})`);
});

// -- 3. REALISM ---------------------------------------------------------------

test("REALISM: replay every real 0x0cd4 dispatch — game-visible RAM identical to the oracle", () => {
  const caps = captureEntries(16, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0cd4 dispatch in a long attract run");
  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  console.log(`  REALISM: ${caps.length} real 0x0cd4 dispatch(es) — game-visible RAM identical to the oracle`);
});
