// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for killMarioOnObjectCollision (ROM 0x2808) — kill Mario when a board
 * object overlaps his hitbox: load his search inputs (block base in IY, Y in C, the 0x0407
 * box), dispatch the current board's collision handler, and on a hit (result 1) write
 * result − 1 (= 0) into MARIO_ACTIVE, marking him dead; on a miss (result 0) do nothing.
 *
 * This is NOT a leaf — it runs a full collision handler that sweeps object records — so it
 * is validated by MEMORY-equivalence against the frozen oracle (RAM − the stack scratch below the entry SP),
 * never the full register file and never cycles, with a FRESH clone per case. The
 * result byte (A) and the search's IX are DEAD after the routine — the caller (loc_197a,
 * 0x19b6) issues its next collision call without reading them — so they are excluded from
 * the contract; the memory-observable effect is MARIO_ACTIVE alone.
 *
 * The dissolved handler chain returns a JS tuple and does NO guest-stack ops, so pc/SP are
 * NOT compared: the candidate leaves the caller return on the stack where the oracle's tail
 * dispatch consumes it (SP diverges by exactly that word). That is a seam artifact, not a
 * live-out; the whole-game SP tests guard SP-correctness now. Any residue the oracle leaves
 * in dead stack scratch is excluded by the RAM diff via STACK_SCRATCH.
 *
 *   1. REACHABILITY — 0x2808 is dispatched during attract (the per-frame cascade calls it).
 *
 *   2. REALISM (captured attract dispatches) — hook 0x2808 in attract, clone at each real
 *      dispatch, run the ORACLE on one clone and killMarioOnObjectCollision on another, and
 *      prove RAM(−stack) + pc + SP identical. The FULL oracle handler runs on BOTH sides, so
 *      a wrong search input or a live register handoff the folded bracket would have supplied
 *      surfaces as divergent memory.
 *
 *   3. EQUAL (crafted, both arms) — on a real captured state, craft a guaranteed HIT (one
 *      object placed exactly on Mario in the first-swept array, every other record
 *      deactivated) and a guaranteed clean MISS (every swept record deactivated), poked
 *      identically on both sides, and prove the same contract. Each arm is checked
 *      non-vacuous (the oracle kills / leaves alone as intended).
 *
 *   4. TEETH — three broken twins, each MUST be caught at MARIO_ACTIVE (0x6200):
 *      (a) no-decrement — writes the raw result (1) instead of result − 1 (0) on a hit.
 *      (b) always-write — drops the zero gate, so a miss writes 0 − 1 = 0xff.
 *      (c) wrong-coordinate — feeds Mario's X where the box compare wants his Y, so the
 *          crafted hit (X and Y 0x40 apart, beyond the box) misses and Mario is not killed.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2808.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2808 as oracle } from "../../translated/loc_2808.js";
import { killMarioOnObjectCollision } from "../killMarioOnObjectCollision.js";
import { dispatchBoardCollision } from "../dispatchBoardCollision.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  BOARD,
  MARIO_ACTIVE,
  MARIO_X,
  MARIO_Y,
  OBJ_ARRAY_67,
  OBJ_ARRAY_64,
  OBJ_RECORD_66A0,
  OBJ_ACTIVE,
  OBJ_X,
  OBJ_Y,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2808;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// Crafted hit coordinates — X and Y a full 0x40 apart (beyond the box's 7-tall / 4-wide
// extents) so a twin that swaps the compare coordinate deterministically misses.
const HIT_X = 0x80;
const HIT_Y = 0x40;

// First differing RAM byte between two dumps, EXCLUDING the dead stack-scratch region (the
// memory-equivalence contract is RAM − the stack scratch below the entry SP; the oracle leaves its dropped call/ret
// bracket words there and this routine does not). Returns { addr, a, b } or null.
function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

// Contract diff: RAM − the stack scratch below the entry SP. Live-out is memory-only (MARIO_ACTIVE); the result byte A
// and the search's IX are dead after the routine, so they are not compared. pc/SP are NOT compared:
// the dissolved handler chain does no guest-stack ops, so the candidate leaves the caller return on
// the stack while the oracle's tail-dispatch consumes it — a seam artifact, not a live-out. The
// whole-game SP tests guard SP-correctness now.
function contractDiffs(entry, fn) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  fn(b);
  const diffs = [];
  const ram = firstRamDiffExStack(a.dumpState(), b.dumpState(), (o) => a.stateOffsetToAddr(o), entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  return diffs;
}

// Run the ORACLE on a fresh clone (for non-vacuity classification).
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

// Hook 0x2808 in a plain attract run and clone the machine at up to K real dispatches. The
// wrapper clones the entry state (only while capturing), then runs the oracle so the host
// game proceeds undisturbed; capturing is gated off after the host run so the isolated
// replays below cannot pollute it.
function captureAttract(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[TARGET, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

// Deactivate every record the 25m handler (0x2880) sweeps — 0x6700 (10 × stride 0x20),
// 0x6400 (5 × stride 0x20), and the single 0x66A0 — by clearing each record's active flag
// (OBJ_ACTIVE, +0). With every slot inactive the object search finds nothing.
function deactivateSweptRecords(m) {
  for (let i = 0; i < 10; i++) m.mem.write8(OBJ_ARRAY_67 + i * 0x20 + OBJ_ACTIVE, 0);
  for (let i = 0; i < 5; i++) m.mem.write8(OBJ_ARRAY_64 + i * 0x20 + OBJ_ACTIVE, 0);
  m.mem.write8(OBJ_RECORD_66A0 + OBJ_ACTIVE, 0);
}

// A guaranteed clean miss: 25m board, Mario alive, every swept record inactive.
function craftMiss(base) {
  const m = base.clone();
  m.mem.write8(BOARD, 1);
  m.mem.write8(MARIO_ACTIVE, 1);
  deactivateSweptRecords(m);
  return m;
}

// A guaranteed single hit: 25m board, Mario alive at (HIT_X, HIT_Y), every record inactive
// except record 0 of the first-swept array, which is zeroed (so its extended-range bytes
// cannot drag the box test off), activated, and pinned exactly onto Mario.
function craftHit(base) {
  const m = base.clone();
  m.mem.write8(BOARD, 1);
  m.mem.write8(MARIO_ACTIVE, 1);
  m.mem.write8(MARIO_X, HIT_X);
  m.mem.write8(MARIO_Y, HIT_Y);
  deactivateSweptRecords(m);
  for (let k = 0; k < 0x20; k++) m.mem.write8(OBJ_ARRAY_67 + k, 0);
  m.mem.write8(OBJ_ARRAY_67 + OBJ_ACTIVE, 1);
  m.mem.write8(OBJ_ARRAY_67 + OBJ_X, HIT_X);
  m.mem.write8(OBJ_ARRAY_67 + OBJ_Y, HIT_Y);
  return m;
}

// -- 1. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x2808 is dispatched during attract", () => {
  let count = 0;
  const boards = new Set();
  const snap = new Map([[TARGET, (mm) => { count++; boards.add(mm.mem.read8(BOARD)); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(2000);
  assert.ok(count > 0, "0x2808 should be dispatched — the per-frame update cascade (loc_197a) calls it");
  console.log(`  REACHABILITY: ${count} natural 0x2808 dispatches in 2000 attract frames; BOARD values {${[...boards].map(hx).join(", ")}}`);
});

// -- 2. REALISM (captured attract dispatches) ---------------------------------

test("REALISM: real captured attract 0x2808 dispatches — RAM(−stack) matches", () => {
  const caps = captureAttract(200, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x2808 dispatch during attract");

  let kills = 0, noKills = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, killMarioOnObjectCollision);
    assert.equal(diffs.length, 0, diffs.length ? `captured dispatch: ${diffs.join("; ")}` : "");
    const before = cap.mem.read8(MARIO_ACTIVE);
    const after = runOracle(cap).mem.read8(MARIO_ACTIVE);
    if (before !== 0 && after === 0) kills++; else noKills++;
  }
  console.log(`  REALISM: ${caps.length} real dispatches identical to the oracle (${kills} kill, ${noKills} no-kill)`);
});

// -- 3. EQUAL (crafted, both arms) --------------------------------------------

test("EQUAL (crafted): the hit and clean-miss arms both match the oracle", () => {
  const base = captureAttract(1, 1500)[0];
  assert.ok(base, "expected a real 0x2808 attract state to craft from");

  // HIT arm: one object on Mario -> the oracle kills him (MARIO_ACTIVE 1 -> 0).
  const hit = craftHit(base);
  assert.equal(runOracle(hit).mem.read8(MARIO_ACTIVE), 0, "crafted hit should kill Mario in the oracle");
  assert.deepEqual(contractDiffs(hit, killMarioOnObjectCollision), [], "hit arm diverged from the oracle");

  // MISS arm: every record inactive -> the oracle leaves Mario alone.
  const miss = craftMiss(base);
  assert.equal(runOracle(miss).mem.read8(MARIO_ACTIVE), 1, "crafted miss should leave Mario alive in the oracle");
  assert.deepEqual(contractDiffs(miss, killMarioOnObjectCollision), [], "miss arm diverged from the oracle");

  console.log("  EQUAL/crafted: hit (Mario killed) and clean-miss (untouched) arms identical to the oracle");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin (a): writes the raw result instead of result − 1 (no `dec a`). */
function brokenNoDec(m) {
  const { mem } = m;
  const { overlap } = dispatchBoardCollision(m, { iy: MARIO_ACTIVE, c: mem.read8(MARIO_Y), bounds: 0x0407 });
  if (overlap === 0) return;
  mem.write8(MARIO_ACTIVE, overlap); // BUG: should be overlap - 1
}

/** Broken twin (b): drops the zero gate, so a miss writes 0 − 1 = 0xff. */
function brokenAlwaysWrite(m) {
  const { mem } = m;
  const { overlap } = dispatchBoardCollision(m, { iy: MARIO_ACTIVE, c: mem.read8(MARIO_Y), bounds: 0x0407 });
  mem.write8(MARIO_ACTIVE, overlap - 1); // BUG: no `if (overlap === 0) return`
}

/** Broken twin (c): feeds Mario's X where the box compare wants his Y. */
function brokenWrongCoord(m) {
  const { mem } = m;
  const { overlap } = dispatchBoardCollision(m, { iy: MARIO_ACTIVE, c: mem.read8(MARIO_X), bounds: 0x0407 }); // BUG: X, not MARIO_Y
  if (overlap === 0) return;
  mem.write8(MARIO_ACTIVE, overlap - 1);
}

test("TEETH: the no-dec, always-write, and wrong-coordinate twins are all CAUGHT", () => {
  const base = captureAttract(1, 1500)[0];
  assert.ok(base, "expected a real 0x2808 attract state to craft from");
  const hit = craftHit(base);
  const miss = craftMiss(base);

  const noDec = contractDiffs(hit, brokenNoDec);
  assert.ok(noDec.length > 0, "the no-dec twin escaped — the gate is worthless");
  assert.ok(noDec[0].startsWith(`RAM@${hx(MARIO_ACTIVE)}`), `expected the no-dec diff at MARIO_ACTIVE, got ${noDec[0]}`);

  const always = contractDiffs(miss, brokenAlwaysWrite);
  assert.ok(always.length > 0, "the always-write twin escaped — the gate is worthless");
  assert.ok(always[0].startsWith(`RAM@${hx(MARIO_ACTIVE)}`), `expected the always-write diff at MARIO_ACTIVE, got ${always[0]}`);

  const wrong = contractDiffs(hit, brokenWrongCoord);
  assert.ok(wrong.length > 0, "the wrong-coordinate twin escaped — the gate is worthless");
  assert.ok(wrong[0].startsWith(`RAM@${hx(MARIO_ACTIVE)}`), `expected the wrong-coordinate diff at MARIO_ACTIVE, got ${wrong[0]}`);

  console.log(`  TEETH: no-dec (${noDec[0]}); always-write (${always[0]}); wrong-coordinate (${wrong[0]}) all caught`);
});
