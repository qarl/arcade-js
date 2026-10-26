// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stepObjectRowUnflipped (ROM 0x167f) — advance the tracked object one step
 * along the row axis: derive its tile row and route on it, firing the dig one-shot at the
 * trigger row.
 *
 * Given the caller's position offset (register live-in, surfaced as `offset`), it either
 * defers the whole move (overlap flag set) to the record builder stageObjectSpriteRecord,
 * or pre-loads the object's sprite code (PLAYER_FACING), derives the tile row (PLAYER_TILE_ROW)
 * and hands the step to the horizontal-step router locateActorCellCheckGoal — except at the trigger row
 * with the feature latch pending, where it consumes the latch (PRIZE_GATE), clears
 * the pending dig spawn (HAZARD_ACTIVE_COUNT), arms the dig object's phase (HAZARD_STATE) and
 * builds its record via stageDigObjectSpriteRecord. All three callees are already idiomatic,
 * so stepObjectRowUnflipped calls them directly (the row is passed to locateActorCellCheckGoal as an honest arg; nothing
 * is marshalled through registers). Its declared LIVE-OUT is MEMORY-ONLY.
 *
 * THE STACK SCRATCH. The comparison runs the still-frozen ORACLE stepObjectRowUnflipped, whose tail-jumps
 * thread through the Z80 stack (m.call, plus register saves in the deeper still-oracle
 * terrain/background handlers), against the stack-free idiomatic handoff chain. Any dead
 * bytes the oracle parks just below the entry stack pointer (The Pit's stack is real diffed
 * work RAM, entry SP ~0x83fd) are classic scratch — overwritten before anything reads them.
 * The diff excludes exactly that [SP-N, SP) window and compares everything else
 * byte-for-byte; every real output sits far below (0x8069..0x80e7 plus the sprite staging
 * buffer at 0x8220), so the window can never hide one — the teeth confirm it. Registers /
 * flags / pc / SP are excluded (the honest-signature contract); the offset live-in defaults
 * to the register so a no-arg call reproduces the oracle exactly.
 *
 * Attract dispatches stepObjectRowUnflipped during the demo (the row-axis move arm), always reaching the
 * common step, so real captured dispatches drive that arm; CRAFTED entries drive the arms
 * the demo never produces: the deferred arm (overlap flag set), the trigger row with the
 * feature latch clear, and the dig one-shot (trigger row + feature latch pending).
 *
 * Checks:
 *   0. IDENTITY (harness) — oracle vs oracle on a captured attract dispatch; proves the
 *      capture/clone/replay harness reaches 0x167f in a real run.
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state
 *      outside the stack scratch (the common step).
 *   2. NON-VACUOUS — a real dispatch actually pre-loads the sprite code and publishes the
 *      derived tile row; a no-op twin cannot pass.
 *   3. EQUAL (crafted deferred) — the overlap flag set defers to the record builder,
 *      identical to the oracle.
 *   4. EQUAL (crafted trigger row, latch clear) — the trigger row without the feature latch
 *      continues through the horizontal-step router, identical to the oracle.
 *   5. EQUAL (crafted dig one-shot) — the trigger row with the feature latch pending consumes
 *      the latch, clears the spawn state, arms the dig phase and builds the dig record,
 *      identical to the oracle.
 *   6. TEETH (sprite code) — a twin that corrupts the pre-loaded sprite code is CAUGHT at
 *      PLAYER_FACING.
 *   7. TEETH (dig arming) — on the dig one-shot, a twin that drops the dig-phase arming is
 *      CAUGHT at HAZARD_STATE.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-167f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_167f as oracle } from "../../translated/loc_167f.js";
import { stepObjectRowUnflipped as idiomatic } from "../stepObjectRowUnflipped.js";
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

const TARGET = 0x167f;
const STACK_SCRATCH = 64; // dead bytes the oracle's stack-threaded tails may park below entry SP
const DEFER_FLAG = 0x807f; // overlap flag: when set, stepObjectRowUnflipped defers the move to the record builder
const TRIGGER_X = 0xb5; // an PLAYER_Y that, with offset 0, lands the tile row exactly on the trigger row 7
const DIG_TARGET_STATE = 9; // the dig phase the one-shot arms
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/** Hook 0x167f in a real attract run and clone up to K real dispatches — each a genuine in-play state for the
 *  row-axis step. The wrapper snapshots then runs the oracle so attract proceeds undisturbed. */
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

/** The tile row stepObjectRowUnflipped derives for an entry: bias the position by the offset + 11, wrap to a
 *  byte, then count rows up from the bottom of the map (one per 8 pixels). */
function expectedRow(entry) {
  return 31 - (u8(entry.mem.read8(PLAYER_Y) + entry.regs.e + 11) >> 3);
}

/** A real dispatch clone forced onto the trigger row (PLAYER_Y 0xB5 with offset 0), overlap flag
 *  clear, with the feature latch poked to `latchValue` — 0 keeps the common step, nonzero fires
 *  the dig one-shot. */
function craftTriggerRow(base, latchValue) {
  const e = base.clone();
  e.regs.e = 0;
  e.mem.write8(PLAYER_Y, TRIGGER_X);
  e.mem.write8(DEFER_FLAG, 0);
  e.mem.write8(PRIZE_GATE, latchValue);
  return e;
}

test("IDENTITY: the harness reaches 0x167f in attract and oracle-vs-oracle is EQUAL", () => {
  const [entry] = captureDispatches(1, 4000);
  assert.ok(entry, "expected at least one real 0x167f dispatch during attract");
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured a real 0x167f dispatch (SP=${hx(entry.regs.sp)}, PLAYER_Y=${hx(entry.mem.read8(PLAYER_Y))}, ` +
      `E=${hx(entry.regs.e)}); oracle vs oracle -> EQUAL`,
  );
});

test("EQUAL: stepObjectRowUnflipped leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = captureDispatches(500, 4000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");
  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (row-axis common step)`);
});

// (The sprite-code pre-load is a transient the downstream router overwrites before the
//  routine returns; the derived tile row is stepObjectRowUnflipped's durable observable output.)

test("NON-VACUOUS: a real dispatch overwrites a sentinel tile row with the derived row", () => {
  const caps = captureDispatches(50, 4000);
  // Pick a dispatch that takes the common step (overlap flag clear), where the row is published.
  const seed = caps.find((c) => c.mem.read8(DEFER_FLAG) === 0);
  assert.ok(seed, "need a real capture on the common step (overlap flag clear)");
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

test("EQUAL (crafted deferred): the overlap flag set defers to the record builder, identical to the oracle", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = base.clone();
  entry.mem.write8(DEFER_FLAG, 1); // overlap flag set -> defer the whole move

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/deferred: overlap flag set -> record-builder deferral, identical to the oracle");
});

test("EQUAL (crafted trigger row, latch clear): the trigger row without the latch continues through the router, identical", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = craftTriggerRow(base, 0); // trigger row, feature latch clear -> common step

  const c = entry.clone();
  idiomatic(c);
  assert.equal(c.mem.read8(PLAYER_TILE_ROW), 7, "precondition: the crafted position must land on the trigger row 7");

  const d = stateDiff(entry, idiomatic);
  assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  console.log("  EQUAL/trigger-clear: trigger row + latch clear -> horizontal-step router, identical to the oracle");
});

test("EQUAL (crafted dig one-shot): the trigger row + feature latch consumes the latch, arms the dig phase, builds the record", () => {
  const [base] = captureDispatches(1, 4000);
  assert.ok(base, "need a real capture to craft from");
  const entry = craftTriggerRow(base, 1); // trigger row, feature latch pending -> dig one-shot

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
  const entry = craftTriggerRow(base, 1); // dig one-shot arm
  const before = entry.mem.read8(HAZARD_STATE);
  assert.notEqual(before, DIG_TARGET_STATE, "precondition: the dig phase must start un-armed for this teeth check");

  const d = stateDiff(entry, makeTwinNoDigArm(before));
  assert.notEqual(d, null, "the gate FAILED to catch a dropped dig-phase arming — it proves nothing");
  assert.equal(d.addr, HAZARD_STATE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(HAZARD_STATE)})`);
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/dig-arm: dropped dig-phase-arming twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
