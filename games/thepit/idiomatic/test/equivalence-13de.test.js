// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceTrackedObject (ROM 0x13de) — the body of the per-frame object/state
 * dispatcher. It reads a chain of the tracked object's control bytes and hands the frame to
 * exactly one handler (defer/stage, do nothing, a carve prologue, a walk stepper, the control
 * step, the walk-forward continuation, or the tile-cell tail). It writes no RAM of its own.
 *
 * OBSERVABLE-EQUIVALENCE CONTRACT. Every effect is produced by the chosen handler; the caller
 * (the countdown gate) tail-jumps here and reads no register back, so the declared LIVE-OUT is
 * MEMORY-ONLY. The idiomatic routine calls the already-decompiled handlers directly, while the
 * still-frozen ORACLE reaches them by tail-jump through the Z80 registry. The oracle's handler
 * chain threads a few bytes through the stack, leaving dead scratch just below the entry stack
 * pointer (The Pit's stack is real diffed work RAM, ~0x83fd here) that the stack-free idiomatic
 * chain does not reproduce — measured at most 6 bytes on the real attract paths. The diff
 * excludes exactly that [SP-16, SP) window and compares everything else byte-for-byte; every
 * real output lives far below the stack (0x8000..0x813x, the sprite records at 0x8220+, video
 * RAM 0x9000+), so the window can never hide one — the teeth confirm it. pc, SP and the value
 * registers are excluded (the honest-signature contract).
 *
 * THE REGISTER LIVE-OUT. advanceTrackedObject loads the object's position-bias pair (the word at 0x806c)
 * into D and E before dispatching; the tile-cell tail reads the column bias from D and the
 * still-oracle position handlers (reached via the at-rest router routeIdleObjectByMoveCommand) read both bytes as
 * the object's move deltas. That is a genuine register boundary the idiomatic routine
 * reproduces — dropping the E half forks PLAYER_FACING on the control-step path.
 *
 * REACHABILITY. Attract dispatches five arms: nothing-active (388×), the control step (1429×),
 * the two walk steppers (217× / 119×), and the carve prologue (9× over 3000 frames). The other
 * six arms never occur in attract, so each is gated on a real captured DE-stage entry (active,
 * at rest, arm idle) with the one or two gate bytes that force it poked identically on both
 * sides — a real state with a surgical nudge.
 *
 * Checks:
 *   0. IDENTITY (harness) — capture real 0x13de dispatches in attract, confirm the reached arms
 *      appear, and confirm the oracle run is deterministic (oracle vs oracle -> identical).
 *   1. EQUAL (real dispatches) — every captured attract dispatch leaves identical state outside
 *      the stack scratch.
 *   2. EQUAL (crafted arms) — each of the six arms attract never reaches is forced from a real
 *      DE-stage entry and leaves identical state; the forced branch is confirmed non-vacuously.
 *   3. TEETH (dropped active guard) — a twin that drops the "no live object" guard and dispatches
 *      a dead object is CAUGHT on a nothing-active entry.
 *   4. TEETH (wrong walk handler) — a twin that routes a positive motion marker to the object
 *      walker instead of the player walk step is CAUGHT on a positive-marker entry.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-13de.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_13de as oracle } from "../../translated/loc_13de.js";
import { advanceTrackedObject as idiomatic } from "../advanceTrackedObject.js";
import { advanceObjectWalkFrame } from "../advanceObjectWalkFrame.js";
import { walkActor } from "../walkActor.js";
import { stepObjectFromControl } from "../stepObjectFromControl.js";
import { makeMachineFactory } from "../../machine.js";
import {
  PLAYER_ACTIVE,
  BOARD_END_PHASE,
  DIG_COLLISION_STATE,
  GOAL_TILE_LATCH,
  PIT_CROSS_ACTIVE,
  PIT_FLOOR_REVEAL_CURSOR,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x13de;
const STACK_SCRATCH = 16; // dead-scratch window below entry SP (measured max 6 bytes on the real
// attract paths; 16 leaves margin for the deeper crafted arms, and no real work-RAM output lives in 0x83xx)

// The tracked-object control bytes without a names.js name yet.
const BUSY_THIS_FRAME = 0x807a;
const MOTION_MARKER = 0x8075;
const BIAS_LO = 0x806c;
const COLUMN_BIAS = 0x806d;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The engine drives makeMachine(overrides) synchronously; The Pit's registry is async, so build
// the factory once (it closes over the built registry).
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

const R = (mm, a) => mm.mem.read8(a);

/** Re-derive which arm advanceTrackedObject takes for an entry, from its gate bytes (for coverage + non-vacuity). */
function branchOf(mm) {
  if (R(mm, BUSY_THIS_FRAME) !== 0) return "busy->stage";
  if (R(mm, PLAYER_ACTIVE) === 0) return "inactive->return";
  if (R(mm, BOARD_END_PHASE) !== 0) return "spawnbusy->return";
  const arm = R(mm, DIG_COLLISION_STATE);
  if (arm === 1) return "armed->prologue";
  if (arm !== 0) return "armed+->stage";
  const mk = R(mm, MOTION_MARKER);
  if (mk >= 128) return "marker<0->objectWalk";
  if (mk !== 0) return "marker>0->playerWalk";
  if (R(mm, GOAL_TILE_LATCH) === 0) return "goal0->controlStep";
  if (R(mm, PIT_CROSS_ACTIVE) !== 0) return "crossing->walkForward";
  if (R(mm, PIT_FLOOR_REVEAL_CURSOR) === 0) return "reveal0->tileTail";
  return "else->controlStep";
}

/**
 * Hook 0x13de in a real attract run and clone the machine at each of its first `limit` dispatches
 * that pass `keep`. The wrapper snapshots then runs the oracle so attract proceeds undisturbed.
 */
function capture(limit, maxFrames, keep = () => true) {
  const caps = [];
  const overrides = new Map([[TARGET, (mm) => {
    if (caps.length < limit && keep(mm)) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  makeMachine(overrides).runFrames(maxFrames);
  return caps;
}

/**
 * First differing state byte between two machines, EXCLUDING the dead stack scratch the oracle's
 * stack-threaded handler chain parks just below the entry stack pointer. Null when otherwise identical.
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
 *  byte outside the stack scratch (or null). */
function stateDiff(entry, fn) {
  const sp = entry.regs.sp;
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  fn(b);
  return stateDiffOutsideStack(a, b, sp);
}

// Entry filters over the attract distribution.
const isInactive = (mm) => R(mm, BUSY_THIS_FRAME) === 0 && R(mm, PLAYER_ACTIVE) === 0;
const isMarkerPos = (mm) =>
  R(mm, BUSY_THIS_FRAME) === 0 && R(mm, PLAYER_ACTIVE) !== 0 && R(mm, BOARD_END_PHASE) === 0 &&
  R(mm, DIG_COLLISION_STATE) === 0 && R(mm, MOTION_MARKER) > 0 && R(mm, MOTION_MARKER) < 128;
// A "DE-stage" entry: reaches the position-bias load with every later gate at rest, so a single
// poke drives it to any downstream arm.
const isDeStage = (mm) =>
  R(mm, BUSY_THIS_FRAME) === 0 && R(mm, PLAYER_ACTIVE) !== 0 && R(mm, BOARD_END_PHASE) === 0 &&
  R(mm, DIG_COLLISION_STATE) === 0 && R(mm, MOTION_MARKER) === 0 && R(mm, GOAL_TILE_LATCH) === 0;

// -- 0. IDENTITY (harness sanity) --------------------------------------------

test("IDENTITY: the harness reaches 0x13de in attract, the reached arms appear, and oracle-vs-oracle is EQUAL", () => {
  const caps = capture(4000, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x13de dispatch during attract");

  const seen = new Set(caps.map(branchOf));
  for (const arm of ["inactive->return", "goal0->controlStep", "marker>0->playerWalk", "marker<0->objectWalk"]) {
    assert.ok(seen.has(arm), `expected the ${arm} arm to occur in attract`);
  }

  const entry = caps[0];
  assert.equal(stateDiff(entry, oracle), null, "oracle vs oracle must be identical");
  console.log(
    `  IDENTITY: captured ${caps.length} real dispatches (arms: ${[...seen].join(", ")}); ` +
      `oracle deterministic (SP=${hx(entry.regs.sp)})`,
  );
});

// -- 1. EQUAL over real captured attract dispatches --------------------------

test("EQUAL: advanceTrackedObject leaves the same state as the oracle over every real attract dispatch", () => {
  const caps = capture(2000, 3000);
  assert.ok(caps.length >= 1, "expected at least one captured attract dispatch");

  for (const cap of caps) {
    const d = stateDiff(cap, idiomatic);
    assert.equal(d, null, d && `state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b} (arm ${branchOf(cap)})`);
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical to the oracle (outside stack scratch)`);
});

// -- 2. EQUAL on the six crafted arms attract never reaches ------------------

test("EQUAL (crafted arms): each unreached arm, forced from a real DE-stage entry, matches the oracle", () => {
  const [base] = capture(1, 3000, isDeStage);
  assert.ok(base, "need a real DE-stage entry to craft the unreached arms from");

  const arms = [
    { arm: "busy->stage", pokes: [[BUSY_THIS_FRAME, 1]] },
    { arm: "spawnbusy->return", pokes: [[BOARD_END_PHASE, 1]] },
    { arm: "armed+->stage", pokes: [[DIG_COLLISION_STATE, 2]] },
    { arm: "crossing->walkForward", pokes: [[GOAL_TILE_LATCH, 1], [PIT_CROSS_ACTIVE, 0x50]] },
    { arm: "reveal0->tileTail", pokes: [[GOAL_TILE_LATCH, 1], [PIT_CROSS_ACTIVE, 0], [PIT_FLOOR_REVEAL_CURSOR, 0]] },
    { arm: "else->controlStep", pokes: [[GOAL_TILE_LATCH, 1], [PIT_CROSS_ACTIVE, 0], [PIT_FLOOR_REVEAL_CURSOR, 5]] },
  ];

  for (const { arm, pokes } of arms) {
    const entry = base.clone();
    for (const [addr, val] of pokes) entry.mem.write8(addr, val);

    assert.equal(branchOf(entry), arm, `craft did not reach the ${arm} arm (got ${branchOf(entry)})`);
    const d = stateDiff(entry, idiomatic);
    assert.equal(d, null, d && `${arm}: state diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }
  console.log(`  EQUAL/crafted: all ${arms.length} unreached arms forced + identical to the oracle`);
});

// -- 3. TEETH (dropped active guard) -----------------------------------------

/** Broken twin: reproduces advanceTrackedObject but DROPS the "no live object" guard, so it dispatches even
 *  when the tracked object is dead. On a nothing-active entry the oracle returns without writing,
 *  so the twin's handler writes are the divergence. */
function twinNoActiveGuard(m) {
  const { mem8, regs } = m;
  if (mem8[BUSY_THIS_FRAME] !== 0) return idiomatic(m);
  // BUG: the `if (mem8[PLAYER_ACTIVE] === 0) return;` guard is gone.
  if (mem8[BOARD_END_PHASE] !== 0) return;
  regs.e = mem8[BIAS_LO];
  regs.d = mem8[COLUMN_BIAS];
  if (mem8[DIG_COLLISION_STATE] !== 0) return idiomatic(m);
  const marker = mem8[MOTION_MARKER];
  if (marker >= 128) return advanceObjectWalkFrame(m);
  if (marker !== 0) return walkActor(m);
  return stepObjectFromControl(m);
}

test("TEETH (dropped active guard): dispatching a dead object is CAUGHT", () => {
  const [entry] = capture(1, 3000, isInactive);
  assert.ok(entry, "need a nothing-active entry to seed the teeth check");
  assert.equal(R(entry, PLAYER_ACTIVE), 0, "expected a nothing-active entry");

  const d = stateDiff(entry, twinNoActiveGuard);
  assert.notEqual(d, null, "the gate FAILED to catch the dropped-guard twin — it proves nothing");
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/active-guard: dropped-guard twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. TEETH (wrong walk handler) -------------------------------------------

/** Broken twin: routes a positive motion marker to the object walker instead of the player walk
 *  step (the two write different position/animation state). */
function twinWrongWalk(m) {
  const { mem8, regs } = m;
  regs.e = mem8[BIAS_LO];
  regs.d = mem8[COLUMN_BIAS];
  return advanceObjectWalkFrame(m); // BUG: a positive marker should run walkActor
}

test("TEETH (wrong walk handler): routing a positive motion marker to the object walker is CAUGHT", () => {
  const [entry] = capture(1, 3000, isMarkerPos);
  assert.ok(entry, "need a positive-motion-marker entry to seed the teeth check");
  assert.equal(branchOf(entry), "marker>0->playerWalk", "expected a positive-marker (player-walk) entry");

  const d = stateDiff(entry, twinWrongWalk);
  assert.notEqual(d, null, "the gate FAILED to catch the wrong-walk-handler twin — it proves nothing");
  assert.equal(stateDiff(entry, idiomatic), null, "idiomatic must pass the entry the twin fails");
  console.log(`  TEETH/wrong-walk: wrong-walk twin caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
