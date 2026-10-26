// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stepObjectRowFlipped (ROM 0x1493) — step the tracked object the opposite
 * way along its move axis: derive its tile row and route on it, firing the dig one-shot at
 * the boundary row.
 *
 * Given the caller's position offset (register live-in, surfaced as `offset`), it either
 * defers the whole move (busy flag set) to the record builder stageObjectSpriteRecord, or
 * forces the object's sprite code (PLAYER_FACING), derives the tile row (PLAYER_TILE_ROW) and
 * hands the step to the positioning front locateObjectCellCheckGoal — except at the boundary row with the
 * feature latch pending, where it consumes the latch (PRIZE_GATE), clears the pending
 * dig spawn (HAZARD_ACTIVE_COUNT), arms the dig object's phase (HAZARD_STATE) and builds its record
 * via stageDigObjectSpriteRecord. All three callees are already idiomatic, so stepObjectRowFlipped calls
 * them directly (the row is passed to locateObjectCellCheckGoal as an honest arg; nothing is marshalled through
 * registers). Its declared LIVE-OUT is MEMORY-ONLY.
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE stepObjectRowFlipped, whose tail-jumps
 * thread through the Z80 stack (m.call, plus register saves in the deeper still-oracle
 * tile-resolver / background handlers), against the stack-free idiomatic handoff chain. Any
 * dead bytes the oracle parks just below the entry stack pointer (The Pit's stack is real
 * diffed work RAM, entry SP ~0x83fd) are classic scratch — overwritten before anything reads
 * them. The diff excludes exactly that [SP-N, SP) window and compares everything else
 * byte-for-byte; every real output sits far below (0x8069..0x80e7 plus the sprite staging
 * buffer at 0x8220), so the window can never hide one — the teeth confirm it. Registers /
 * flags / pc / SP are excluded (the honest-signature contract); the offset live-in defaults to
 * the register so a no-arg call reproduces the oracle exactly.
 *
 * Attract dispatches stepObjectRowFlipped during the demo (62x / 4000 frames via this move arm): the
 * common step, plus one natural dig one-shot, so real captured dispatches drive those arms.
 * A CRAFTED entry drives the arm the demo never produces (the deferred arm, busy flag set) and
 * a deterministic boundary-row dig one-shot for the positive + teeth checks.
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured attract dispatch; proves the
 *      capture/clone/replay harness reaches 0x1493 in a real run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state
 *      outside the stack scratch (common step + the natural dig one-shot).
 *   2. NON-VACUOUS — a real dispatch actually publishes the derived tile row; a no-op twin
 *      cannot pass.
 *   3. EQUAL (crafted deferred) — the busy flag set defers to the record builder, identical
 *      to the oracle.
 *   4. EQUAL (crafted boundary row, latch clear) — the boundary row without the feature latch
 *      continues through the positioning front, identical to the oracle.
 *   5. EQUAL (crafted dig one-shot) — the boundary row with the feature latch pending consumes
 *      the latch, clears the spawn state, arms the dig phase and builds the dig record,
 *      identical to the oracle.
 *   6. TEETH (tile row) — a twin that corrupts the published tile row is CAUGHT at PLAYER_TILE_ROW.
 *   7. TEETH (dig arming) — on the dig one-shot, a twin that drops the dig-phase arming is
 *      CAUGHT at HAZARD_STATE.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-1493.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1493 as oracle } from "../../translated/loc_1493.js";
import { stepObjectRowFlipped as idiomatic } from "../stepObjectRowFlipped.js";
import { makeMachineFactory } from "../../machine.js";
import { u8 } from "../../../../core/int.js";
import { PLAYER_Y, PLAYER_TILE_ROW, PRIZE_GATE, HAZARD_ACTIVE_COUNT, HAZARD_STATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x1493;
const STACK_SCRATCH = 64; // dead bytes the oracle's stack-threaded tails may park below entry SP
const DEFER_FLAG = 0x807e; // busy flag: when set, stepObjectRowFlipped defers the move to the record builder
const BOUNDARY_X = 0x48; // an PLAYER_Y that, with offset 0, lands the tile row exactly on the boundary row 22
const BOUNDARY_ROW = 22; // the row the dig one-shot fires on
const DIG_TARGET_STATE = 9; // the dig phase the one-shot arms
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Hook 0x1493 in a real attract run and clone up to K real dispatches — each a genuine in-play state for this
 *  move step. The wrapper snapshots then runs the oracle so attract proceeds undisturbed. */
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
 *  byte outside the stack scratch (or null). The idiomatic offset live-in defaults to the
 *  register, so a no-arg call matches the oracle exactly. */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

/** The tile row stepObjectRowFlipped derives for an entry: bias the position by minus the offset + 3, wrap to
 *  a byte, then count rows down from the top of the map (one per 8 pixels). */
function expectedRow(entry) {
  return 31 - (u8(entry.mem.read8(PLAYER_Y) - entry.regs.e + 3) >> 3);
}

/** A real dispatch clone forced onto the boundary row (PLAYER_Y 0x48 with offset 0), busy flag clear,
 *  with the feature latch poked to `latchValue` — 0 keeps the common step, nonzero fires the dig
 *  one-shot. */
function craftBoundaryRow(base, latchValue) {
  const e = base.clone();
  e.regs.e = 0;
  e.mem.write8(PLAYER_Y, BOUNDARY_X);
  e.mem.write8(DEFER_FLAG, 0);
  e.mem.write8(PRIZE_GATE, latchValue);
  return e;
}

test("IDENTITY: the harness reaches 0x1493 in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 4000);
  assert.ok(entry, "expected at least one real 0x1493 dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x1493 dispatch (SP=${hx(entry.regs.sp)}, PLAYER_Y=${hx(entry.mem.read8(PLAYER_Y))}, ` +
      `E=${hx(entry.regs.e)}); oracle vs oracle -> EQUAL`,
  );
});

test("EQUAL: stepObjectRowFlipped leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(500, 4000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");
  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (common step + dig one-shot)`);
});

// (The forced sprite code is a transient the downstream resolver overwrites before the routine
//  returns; the derived tile row is stepObjectRowFlipped's durable observable output.)

test("NON-VACUOUS: a real dispatch overwrites a sentinel tile row with the derived row", () => {
  const caps = captureDispatches(50, 4000);
  // Pick a dispatch that takes the common step (busy flag clear), where the row is published.
  const seed = caps.find((c) => c.mem.read8(DEFER_FLAG) === 0);
  assert.ok(seed, "need a real capture on the common step (busy flag clear)");
  const row = expectedRow(seed);

  const entry = seed.clone();
  const SENTINEL = row ^ 0xff; // 224..255 — always distinct from a 0..31 row, so a no-op twin cannot pass
  entry.mem.write8(PLAYER_TILE_ROW, SENTINEL);

  const c = entry.clone();
  idiomatic(c);
  assert.notEqual(c.mem.read8(PLAYER_TILE_ROW), SENTINEL, "idiomatic left the tile row unwritten");
  assert.equal(c.mem.read8(PLAYER_TILE_ROW), row, "the tile row was not published to the derived value");

  assert.equal(stateDiff(entry, idiomatic), null, "the entry must also match the oracle");
  console.log(`  NON-VACUOUS: sentinel ${hx(SENTINEL)} overwritten with the derived tile row ${row}`);
});

test("EQUAL (crafted deferred): the busy flag set defers to the record builder, identical to the oracle", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = base.clone();
  entry.mem.write8(DEFER_FLAG, 1); // busy flag set -> defer the whole move

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/deferred: busy flag set -> record-builder deferral, identical to the oracle");
});

test("EQUAL (crafted boundary row, latch clear): the boundary row without the latch continues through the positioning front, identical", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = craftBoundaryRow(base, 0); // boundary row, feature latch clear -> common step

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(PLAYER_TILE_ROW), BOUNDARY_ROW, "precondition: the crafted position must land on the boundary row 22");

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/boundary-clear: boundary row + latch clear -> positioning front, identical to the oracle");
});

test("EQUAL (crafted dig one-shot): the boundary row + feature latch consumes the latch, arms the dig phase, builds the record", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = craftBoundaryRow(base, 1); // boundary row, feature latch pending -> dig one-shot
  entry.mem.write8(HAZARD_STATE, 0); // start un-armed so the arming to 9 is an observable change

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(PRIZE_GATE), 0, "the feature latch was not consumed");
  assert.equal(c.mem.read8(HAZARD_ACTIVE_COUNT), 0, "the pending dig spawn was not cleared");
  assert.equal(c.mem.read8(HAZARD_STATE), DIG_TARGET_STATE, "the dig object phase was not armed");
  console.log("  EQUAL/dig-one-shot: latch consumed, spawn cleared, dig phase armed to 9; identical to the oracle");
});

/** Broken twin: does the real work, then corrupts the published tile row. */
function twinBadTileRow(m) {
  idiomatic(m);
  m.mem.write8(PLAYER_TILE_ROW, m.mem.read8(PLAYER_TILE_ROW) ^ 0xff);
}

test("TEETH (tile row): a twin that corrupts the published tile row is CAUGHT at PLAYER_TILE_ROW", () => {
  const caps = captureDispatches(50, 4000);
  const entry = caps.find((c) => c.mem.read8(DEFER_FLAG) === 0);
  assert.ok(entry, "need a real common-step capture");

  const d = stateDiff(entry, twinBadTileRow);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted tile row — it proves nothing");
  assert.equal(d.addr, PLAYER_TILE_ROW, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(PLAYER_TILE_ROW)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/tile-row: corrupted-row twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: does the real dig one-shot, then reverts the dig-phase arming. */
function makeTwinNoDigArm(before) {
  return (m) => {
    idiomatic(m);
    m.mem.write8(HAZARD_STATE, before);
  };
}

test("TEETH (dig arming): on the dig one-shot, a twin that drops the dig-phase arming is CAUGHT at HAZARD_STATE", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = craftBoundaryRow(base, 1); // dig one-shot arm
  entry.mem.write8(HAZARD_STATE, 0); // start un-armed so the arming to 9 is an observable change
  const before = entry.mem.read8(HAZARD_STATE);
  assert.notEqual(before, DIG_TARGET_STATE, "precondition: the dig phase must start un-armed for this teeth check");

  const d = stateDiff(entry, makeTwinNoDigArm(before));
  assert.notEqual(d, null, "the gate FAILED to catch a dropped dig-phase arming — it proves nothing");
  assert.equal(d.addr, HAZARD_STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HAZARD_STATE)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/dig-arm: dropped dig-phase-arming twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
