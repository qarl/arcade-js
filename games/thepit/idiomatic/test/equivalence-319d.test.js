// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for stepEnemyMover (ROM 0x319d) — the per-frame enemy/object move
 * step: arrival, player-box capture, object-box retarget, and steer into a movement
 * preset.
 *
 * CONTRACT. The routine's declared live-out is MEMORY-ONLY — the mover's state/timer/
 * position bytes, the probe-cell pointer + sub-tile phase, the retarget/capture writes,
 * and whatever the tail preset or transition leaves. The mover is reached by tail-jump,
 * so no caller reads a value register back; the gate compares work RAM (dumpState) and
 * excludes the Z80 pc/SP/value-registers the honest-signature rewrite does not preserve.
 *
 * TWO INPUT SOURCES.
 *   - REAL captured attract dispatches. 0x319d runs thousands of times in the demo, so
 *     the entry state machine and the top-row / far-edge cells are exercised for free;
 *     the demo never takes a probe steer arm, so those are crafted below.
 *   - CRAFTED entries. A real attract state is poked (identically on both sides) to force
 *     the player-box capture, the object-box retarget, and every column/direction steer
 *     arm — the paths attract does not reach.
 *
 * ONE WRINKLE — the arrival / capture tails hand off to the round/state-boundary
 * transition (tickObjectDwellThenTransition -> dockManAndDispatchRoundBoundary), whose real successor chain converges at two TRUE
 * oracle leaves (0x031a round setup, 0x01f9 reset entry) that never return on hardware
 * (they busy-wait on the vblank NMI, which never fires on a single-routine clone). Both
 * the oracle and the candidate reach those same leaves, so the gate stubs them
 * identically on both clones and models the once-per-frame tick their frame-waits drain,
 * so the transition terminates. The RAM diff excludes the stack scratch below the entry SP
 * the oracle's calls leave and the stack-free candidate does not.
 *
 * Checks:
 *   0. HARNESS — capture real 0x319d attract dispatches; the oracle run is deterministic.
 *   1. EQUAL (real dispatches) — stepEnemyMover == oracle over RAM on every captured entry.
 *   2. EQUAL (crafted capture/retarget) — the player-box capture and object-box retarget
 *      paths match the oracle, with positive checks on the armed pose + park state.
 *   3. EQUAL (crafted steer grid) — over a grid of position / column / direction the
 *      chosen probe arm + preset match the oracle byte-for-byte.
 *   4. TEETH (wrong capture pose) — a retarget twin that arms sprite 52 instead of 53 is
 *      CAUGHT at the sprite code.
 *   5. TEETH (wrong probe-cell pointer) — a steer twin that corrupts the decoded cell
 *      pointer is CAUGHT at PROBE_CELL_PTR.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-319d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_319d as oracle } from "../../translated/loc_319d.js";
import { stepEnemyMover as idiomatic } from "../stepEnemyMover.js";
import { tickObjectDwellThenTransition } from "../tickObjectDwellThenTransition.js";
import { requestSound20 } from "../requestSound20.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  ENEMY_WORK_STATE,
  ENEMY_ACTION_TIMER,
  ENEMY_WORK_DIR,
  PROBE_CELL_PTR,
  PLAYER_FACING,
  ENEMY_WORK_SPRITE,
  PLAYER_Y,
  PLAYER_X,
  REACTION_OBJ_X,
  REACTION_OBJ_Y,
  DIG_COLLISION_STATE,
} from "../names.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TARGET = 0x319d;

// The mover's own working-block bytes with no names.js name yet.
const TARGET_COLUMN = 0x8093;
const CURRENT_COLUMN = 0x807a;
const MOVER_X = 0x8083;
const MOVER_Y = 0x8086;
const PLAYER_BOX_OWNER = 0x80a1;

// The two TRUE oracle leaves the arrival/capture transition converges at — each never
// returns on hardware, so the gate stubs both identically on the clones.
const EXPIRY_LEAVES = [0x031a, 0x01f9];
const WATCHDOG = 0xb800; // reading it kicks the watchdog once per frame-wait pass
const COUNTDOWN = 0x8009; // the per-frame countdown the chain's frame-waits drain to 0
// Dead stack scratch: the shallow paths' calls push just below the entry SP. Neither the
// mover RAM (0x8068..0x80f8) nor any other named cell lives in that window.
const SHALLOW_SCRATCH_DEPTH = 128;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

// -- helpers ------------------------------------------------------------------

/** Hook 0x319d in a real attract run and clone the machine at each dispatch (up to
 *  `limit`) — genuine in-play mover states. The wrapper runs the oracle so attract
 *  proceeds undisturbed. */
function captureRealEntries(maxFrames, limit) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < limit) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = makeMachine(snapshot);
  host.runFrames(maxFrames);
  return caps;
}

/** A base attract machine to craft entries from. */
function baseAttractState(startFrame) {
  const m = makeMachine();
  m.runFrames(startFrame);
  return m.clone();
}

/** Identical no-op stub for the transition's terminal leaves: they would otherwise hang
 *  on a single-routine clone by busy-waiting on the NMI. */
function expiryStub() {}

/** Model the once-per-frame interrupt tick that drives the chain's frame-waits to
 *  completion: each watchdog read decrements the frame countdown, floored at 0. Identical
 *  on both clones, so it can only expose a difference, never create one. */
function installFrameTick(m) {
  const mem = m.mem;
  const origRead8 = mem.read8.bind(mem);
  mem.read8 = (addr) => {
    if (addr === WATCHDOG) {
      const c = origRead8(COUNTDOWN);
      if (c !== 0) mem.write8(COUNTDOWN, c - 1);
    }
    return origRead8(addr);
  };
}

/** Clone `entry`, install the identical leaf stubs + frame-tick, run `fn`, and return the
 *  resulting machine — so any arrival/capture tail terminates the same way on both sides. */
function runIsolated(entry, fn) {
  const c = entry.clone();
  for (const addr of EXPIRY_LEAVES) c.routines.set(addr, expiryStub);
  installFrameTick(c);
  fn(c);
  return c;
}

/** First differing RAM byte between two machines (full dumpState), EXCLUDING the dead
 *  stack scratch (the shallow window just below the entry SP). Null when otherwise identical. */
function ramDiff(a, b, entrySP) {
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (deadStackBelow({ lo: entrySP - SHALLOW_SCRATCH_DEPTH, hi: entrySP }, entrySP)(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

/** RAM diff between the oracle run and `fn`'s run from `entry`, or null when identical. */
function ramDiffVsOracle(entry, fn) {
  const sp = entry.regs.sp;
  const o = runIsolated(entry, oracle);
  const c = runIsolated(entry, fn);
  return ramDiff(o, c, sp);
}

/** Poke a base state into a mover that reaches the position decoder + steer for the
 *  given target column and travel direction, at the given pixel position. */
function primeSteerEntry(m, { column, direction, moverX, moverY }) {
  m.mem.write8(ENEMY_WORK_STATE, 1); // positive: run the active step
  m.mem.write8(TARGET_COLUMN, column);
  m.mem.write8(CURRENT_COLUMN, 0xff); // locked (nonzero, != column) -> skip both box tests
  m.mem.write8(PLAYER_BOX_OWNER, 0); // player box not live
  m.mem.write8(ENEMY_WORK_DIR, direction);
  m.mem.write8(MOVER_X, moverX);
  m.mem.write8(MOVER_Y, moverY);
}

// -- 0. HARNESS (reachability + determinism) ---------------------------------

test("HARNESS: real 0x319d attract dispatches are captured and the oracle run is deterministic", () => {
  const caps = captureRealEntries(4000, 40);
  assert.ok(caps.length >= 1, "expected 0x319d to be dispatched during attract");

  for (const cap of caps.slice(0, 8)) {
    const a = runIsolated(cap, oracle);
    const b = runIsolated(cap, oracle);
    const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
    assert.equal(d, null, d && `oracle run not deterministic: diff at ${hx(d.addr ?? 0)}`);
  }
  console.log(
    `  HARNESS: captured ${caps.length} real 0x319d entries (first SP=${hx(caps[0].regs.sp)}); oracle run deterministic`,
  );
});

// -- 1. EQUAL on real captured attract dispatches ----------------------------

test("EQUAL (real dispatches): stepEnemyMover == oracle over RAM on every captured entry", () => {
  const caps = captureRealEntries(4000, 200);
  assert.ok(caps.length >= 1, "need captured 0x319d entries");

  for (const cap of caps) {
    const diff = ramDiffVsOracle(cap, idiomatic);
    assert.equal(diff, null, diff && `real dispatch RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);
  }
  console.log(`  EQUAL/real: ${caps.length} real attract dispatches — work RAM identical to the oracle`);
});

// -- 2. EQUAL on the crafted capture + retarget paths ------------------------

test("EQUAL (player-box capture): the capture path matches the oracle and parks the mover", () => {
  const seed = baseAttractState(300);

  const entry = seed.clone();
  entry.mem.write8(ENEMY_WORK_STATE, 1); // positive -> active step
  entry.mem.write8(TARGET_COLUMN, 3);
  entry.mem.write8(CURRENT_COLUMN, 0); // free (!= target column)
  entry.mem.write8(PLAYER_BOX_OWNER, 1); // capture box live
  entry.mem.write8(REACTION_OBJ_X, 100);
  entry.mem.write8(REACTION_OBJ_Y, 100);
  entry.mem.write8(MOVER_X, 100); // inside the box
  entry.mem.write8(MOVER_Y, 100);

  const diff = ramDiffVsOracle(entry, idiomatic);
  assert.equal(diff, null, diff && `capture RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);

  // Positive check: the mover was parked negative (192, then bumped by the dormant tick).
  const c = runIsolated(entry, idiomatic);
  assert.equal(c.mem.read8(ENEMY_WORK_STATE), 193, "capture must park the mover (192 then +1 from the dormant tick)");
  console.log("  EQUAL/capture: player-box capture matches the oracle; mover parked");
});

test("EQUAL (object-box retarget): the retarget path matches the oracle and arms the capture pose", () => {
  const seed = baseAttractState(300);

  const entry = seed.clone();
  entry.mem.write8(ENEMY_WORK_STATE, 1);
  entry.mem.write8(TARGET_COLUMN, 3);
  entry.mem.write8(CURRENT_COLUMN, 0); // free
  entry.mem.write8(PLAYER_BOX_OWNER, 0); // player box not live -> object-box test
  entry.mem.write8(DIG_COLLISION_STATE, 0); // no dig reaction owns the mover
  entry.mem.write8(PLAYER_Y, 100);
  entry.mem.write8(PLAYER_X, 100);
  entry.mem.write8(MOVER_X, 100); // inside the object box
  entry.mem.write8(MOVER_Y, 100);

  const diff = ramDiffVsOracle(entry, idiomatic);
  assert.equal(diff, null, diff && `retarget RAM diff at ${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`);

  // Positive check: locked to the target column (3), snapped onto the object.
  const c = runIsolated(entry, idiomatic);
  assert.equal(c.mem.read8(CURRENT_COLUMN), 3, "retarget must lock the mover to the target column");
  assert.equal(c.mem.read8(MOVER_X), 100, "retarget must snap the mover onto the object X");
  console.log("  EQUAL/retarget: object-box retarget matches the oracle; mover locked + posed");
});

// -- 3. EQUAL over the crafted steer grid ------------------------------------

test("EQUAL (steer grid): every column/direction/position steer arm matches the oracle", () => {
  const seed = baseAttractState(300);
  const sp = seed.regs.sp;

  let checked = 0;
  for (const column of [3, 5]) {
    for (let direction = 0; direction < 4; direction++) {
      for (const moverX of [124, 128, 130, 160, 200]) {
        for (const moverY of [40, 64, 100]) {
          const entry = seed.clone();
          primeSteerEntry(entry, { column, direction, moverX, moverY });

          const o = runIsolated(entry, oracle);
          const c = runIsolated(entry, idiomatic);
          const diff = ramDiff(o, c, sp);
          assert.equal(
            diff,
            null,
            diff &&
              `col=${column} dir=${direction} X=${moverX} Y=${moverY}: RAM diff at ` +
                `${hx(diff.addr ?? 0)} oracle=${diff.a} cand=${diff.b}`,
          );
          checked++;
        }
      }
    }
  }
  assert.equal(checked, 2 * 4 * 5 * 3, "must have swept the whole steer grid");
  console.log(`  EQUAL/steer: all ${checked} column/direction/position steer arms match the oracle`);
});

// -- 4. TEETH: a wrong capture pose is caught --------------------------------

/** Broken twin of the object-box retarget path: arms sprite 52 instead of 53. */
function twinWrongPose(m) {
  const { mem8 } = m;
  mem8[CURRENT_COLUMN] = mem8[TARGET_COLUMN];
  mem8[MOVER_X] = mem8[PLAYER_Y];
  mem8[MOVER_Y] = mem8[PLAYER_X];
  mem8[ENEMY_ACTION_TIMER] = 129;
  mem8[ENEMY_WORK_SPRITE] = 23;
  mem8[PLAYER_FACING] = 52; // BUG: the capture pose is 53
  requestSound20(m);
  return tickObjectDwellThenTransition(m);
}

test("TEETH (wrong capture pose): a sprite-52 retarget twin is CAUGHT at the sprite code", () => {
  const seed = baseAttractState(300);
  const entry = seed.clone();
  entry.mem.write8(ENEMY_WORK_STATE, 1);
  entry.mem.write8(TARGET_COLUMN, 3);
  entry.mem.write8(CURRENT_COLUMN, 0);
  entry.mem.write8(PLAYER_BOX_OWNER, 0);
  entry.mem.write8(DIG_COLLISION_STATE, 0);
  entry.mem.write8(PLAYER_Y, 100);
  entry.mem.write8(PLAYER_X, 100);
  entry.mem.write8(MOVER_X, 100);
  entry.mem.write8(MOVER_Y, 100);

  const diff = ramDiffVsOracle(entry, twinWrongPose);
  assert.notEqual(diff, null, "the gate FAILED to catch the wrong-pose twin — it proves nothing");
  assert.equal(diff.addr, PLAYER_FACING, `teeth caught the wrong address ${hx(diff.addr ?? 0)} (expected ${hx(PLAYER_FACING)})`);
  console.log(`  TEETH/pose: wrong capture pose caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});

// -- 5. TEETH: a corrupted probe-cell pointer is caught ----------------------

/** Broken twin: run the real routine, then corrupt the decoded probe-cell pointer. */
function twinBadCellPointer(m) {
  idiomatic(m);
  m.mem16[PROBE_CELL_PTR] = m.mem16[PROBE_CELL_PTR] ^ 0x0101;
}

test("TEETH (bad probe-cell pointer): a corrupted decoded pointer is CAUGHT at PROBE_CELL_PTR", () => {
  const seed = baseAttractState(300);
  const entry = seed.clone();
  primeSteerEntry(entry, { column: 3, direction: 0, moverX: 128, moverY: 64 });

  const diff = ramDiffVsOracle(entry, twinBadCellPointer);
  assert.notEqual(diff, null, "the gate FAILED to catch the corrupted cell pointer — it proves nothing");
  assert.ok(
    diff.addr === PROBE_CELL_PTR || diff.addr === PROBE_CELL_PTR + 1,
    `teeth caught the wrong address ${hx(diff.addr ?? 0)} (expected ${hx(PROBE_CELL_PTR)})`,
  );
  console.log(`  TEETH/pointer: corrupted cell pointer caught at ${hx(diff.addr)} (oracle=${diff.a} broken=${diff.b})`);
});
