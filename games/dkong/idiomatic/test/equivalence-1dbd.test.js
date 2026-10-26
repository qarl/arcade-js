// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchEffectState (ROM 0x1DBD) — the router for the effect-sprite state
 * machine held in 0x6340. It reads the state byte and hands the frame to one of three
 * handlers: state 0 -> effectStateIdle (idle no-op), state 1 -> armScorePopupAndSelectAward (arm + advance), state 2
 * -> loc_1e4a (countdown). State 3 is the reset vector and is never produced in play.
 *
 * dispatchEffectState writes no memory itself; every visible byte is the chosen handler's. Its state-1
 * arm runs armScorePopupAndSelectAward's full effect chain (which the idiomatic side reaches through the
 * fully-idiomatic armScorePopupAndSelectAward, the oracle side through its return-modelling chain), so SP/pc
 * and the STACK_SCRATCH region diverge there and are dead (the caller reads no register).
 * The gate is therefore memory-equivalence on RAM − the stack scratch below the entry SP (never the full register
 * file, never cycles, never SP/pc), a FRESH clone per case because the handlers write memory
 * and advance the task ring:
 *
 *   1. REALISM — hook 0x1dbd in a real attract run and clone at each dispatch. Attract
 *      naturally exercises all three reachable states (idle/arm/countdown). For each real
 *      entry, run the ORACLE on one fresh clone and idiomatic dispatchEffectState on another; every
 *      game-visible byte matches (residual confined to the dead STACK_SCRATCH). The
 *      oracle's deepest stack use is asserted to sit inside STACK_SCRATCH so excluding the
 *      region cannot mask a real diff.
 *
 *   2. CRAFTED (state sweep) — on real captured bases, poke 0x6340 to each of {0,1,2}
 *      identically on both sides and compare RAM − the stack scratch below the entry SP. This drives every
 *      reachable arm deterministically even though attract already reaches them.
 *
 *   3. CRAFTED (reset vector) — poke 0x6340 to 3 (the reset-vector slot) identically on
 *      both sides and assert BOTH the oracle and idiomatic dispatchEffectState throw, matching the
 *      defensive behaviour for the untranslated target.
 *
 *   4. TEETH — two deliberately-broken routers, each caught by the state sweep:
 *      (a) the state-2 handler dropped to a no-op — misses the countdown, caught at 0x6341;
 *      (b) the state-1 handler dropped to a no-op — misses the effect one-shot, caught at
 *      the effect sound latch 0x6085.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1dbd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1dbd as oracle } from "../../translated/loc_1dbd.js";
import { dispatchEffectState as idiomatic } from "../dispatchEffectState.js";
import { effectStateIdle } from "../effectStateIdle.js"; // idiomatic handlers, for the teeth twins
import { armScorePopupAndSelectAward } from "../armScorePopupAndSelectAward.js";
import { loc_1e4a } from "../../translated/loc_1e4a.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1dbd;
const STATE = 0x6340;       // the router's state byte (0 idle, 1 arm, 2 countdown, 3 reset)
const STATE_TIMER = 0x6341; // countdown value the state-2 handler works down (arm-distinguishing)
const SND = 0x6085;         // effect sound latch the state-1 chain cues (arm-distinguishing)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible RAM difference between two machines, EXCLUDING the stack scratch below the entry SP
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP; SP/pc are the dropped
 * stack model — the oracle's return chain moves them, the idiomatic state-1 handler does
 * not, and neither is consumed by the caller).
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

/** Replay one entry through the oracle and a candidate on independent FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x1dbd dispatch (loc_197a calls it once
 * per frame). Delegates to the oracle so the host run proceeds undisturbed to a clean stop.
 * Keeps up to K entries per state so a single run yields every reachable arm.
 */
function captureDispatches(perState, maxFrames) {
  const caps = [];
  const kept = { 0: 0, 1: 0, 2: 0 };
  const snap = new Map([[TARGET, (mm) => {
    const st = mm.mem.read8(STATE);
    if (kept[st] !== undefined && kept[st] < perState) { caps.push(mm.clone()); kept[st]++; }
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

// -- 1. REALISM (real captured dispatches) ------------------------------------

test("REALISM: real captured 0x1dbd dispatches — game-visible RAM identical to the oracle", () => {
  const caps = captureDispatches(20, 8000);
  assert.ok(caps.length >= 3, "expected several real 0x1dbd dispatches during attract");

  const statesSeen = new Set();
  for (const entry of caps) {
    const state = entry.mem.read8(STATE);
    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real 0x1dbd entry (state=${state} SP=${hx(entry.regs.sp)})`,
    );
    // The oracle's return chain can pop a couple of words; entry SP must sit inside
    // STACK_SCRATCH so excluding the region cannot mask a real game-visible diff.
    assert.ok(
      entry.regs.sp >= STACK_SCRATCH.lo && entry.regs.sp < STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    statesSeen.add(state);
  }
  assert.ok(
    statesSeen.has(0) && statesSeen.has(1) && statesSeen.has(2),
    `attract must exercise all three reachable states (saw ${[...statesSeen].sort().join(",")})`,
  );
  console.log(`  REALISM: ${caps.length} real 0x1dbd dispatch(es) — RAM identical; states seen: ` +
    [...statesSeen].sort().join(", "));
});

// -- 2. CRAFTED (state sweep over the reachable arms) -------------------------

/**
 * A real captured entry to craft the state sweep onto — one whose effect param-block
 * pointer at 0x6343 points into work RAM. The state-1 handler (armScorePopupAndSelectAward -> stageAward300Popup ->
 * stageAwardPopupAtHitObject) dereferences that pointer, so a base whose pointer is 0x0000 (e.g. a fresh
 * idle base that never armed an effect) would fault when the sweep forces state 1. Every
 * real state-1 dispatch has a live pointer; picking a base with one makes the crafted
 * state-1 arm a faithful live-in, and it is harmless to the state-0 (no-op) and state-2
 * (countdown-only) arms.
 */
function craftedBase(caps) {
  const base = caps.find((c) => {
    const ptr = c.mem.read8(0x6343) | (c.mem.read8(0x6344) << 8);
    return ptr >= 0x6000 && ptr < 0x6c00;
  });
  assert.ok(base, "expected a real 0x1dbd entry with a valid 0x6343 param-block pointer");
  return base;
}

/** Poke 0x6340 to `state` identically on both sides of a base, compare RAM − the stack scratch below the entry SP. */
function sweepState(base, candidate) {
  let mismatch = null;
  const armsSeen = new Set();
  for (const state of [0, 1, 2]) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    for (const m of [a, b]) m.mem.write8(STATE, state);
    oracle(a);
    candidate(b);
    armsSeen.add(state);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad && !mismatch) mismatch = { state, bad };
  }
  return { mismatch, armsSeen };
}

test("CRAFTED (state sweep): dispatchEffectState == oracle over states {0,1,2} (all reachable arms)", () => {
  const base = craftedBase(captureDispatches(20, 8000));
  const { mismatch, armsSeen } = sweepState(base, idiomatic);
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at state ${mismatch.state}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.ok(armsSeen.has(0) && armsSeen.has(1) && armsSeen.has(2), "sweep must drive all three arms");
  console.log(`  CRAFTED/state: states {0,1,2} — RAM identical to the oracle on every reachable arm`);
});

// -- 3. CRAFTED (reset vector — state 3 throws on both sides) ------------------

test("CRAFTED (reset vector): state 3 makes BOTH the oracle and idiomatic dispatchEffectState throw", () => {
  const caps = captureDispatches(1, 8000);
  const base = caps[0];
  assert.ok(base, "expected a real 0x1dbd entry to craft state 3 onto");

  const a = base.clone(), b = base.clone();
  a.mem.write8(STATE, 3);
  b.mem.write8(STATE, 3);
  assert.throws(() => oracle(a), "oracle must throw on the reset-vector state");
  assert.throws(() => idiomatic(b), "idiomatic dispatchEffectState must throw on the reset-vector state");
  console.log(`  CRAFTED/reset: state 3 (ROM 0x0000 reset vector) throws on both sides`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Router builder: dispatch on 0x6340 through a supplied handler table, else the reset error. */
function makeRouter(handlers) {
  return (m) => {
    const state = m.mem.read8(STATE);
    const h = handlers[state];
    if (h) return h(m);
    throw new Error("reset");
  };
}

// Twin (a): the state-2 handler is a no-op — misses the countdown decrement.
const brokenCountdown = makeRouter([effectStateIdle, armScorePopupAndSelectAward, effectStateIdle]);
// Twin (b): the state-1 handler is a no-op — misses the effect one-shot (arm + advance + sound).
const brokenArm = makeRouter([effectStateIdle, effectStateIdle, loc_1e4a]);

test("TEETH (state-2 no-op): the dropped countdown is CAUGHT and names 0x6341", () => {
  const caps = captureDispatches(4, 8000);
  const state2 = caps.find((c) => c.mem.read8(STATE) === 2);
  assert.ok(state2, "expected a real state-2 (countdown) entry");
  const { bad } = replay(state2, brokenCountdown);
  assert.notEqual(bad, null, "the state sweep FAILED to catch a dropped state-2 countdown — it is worthless");
  assert.equal(bad.addr, STATE_TIMER, `expected the caught diff at 0x6341, got ${hx(bad.addr)}`);
  console.log(`  TEETH/state-2: caught at 0x6341 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (state-1 no-op): the dropped effect one-shot is CAUGHT", () => {
  const caps = captureDispatches(4, 8000);
  const state1 = caps.find((c) => c.mem.read8(STATE) === 1);
  assert.ok(state1, "expected a real state-1 (arm) entry");
  const { bad } = replay(state1, brokenArm);
  assert.notEqual(bad, null, "the replay FAILED to catch a dropped state-1 one-shot — it is worthless");
  // The state-1 chain cues the effect sound (0x6085 := 3); the no-op leaves it 0.
  const a = state1.clone(), b = state1.clone();
  oracle(a);
  brokenArm(b);
  assert.notEqual(a.mem.read8(SND), b.mem.read8(SND),
    `the dropped one-shot must diverge the effect sound latch 0x6085 (oracle=${hx(a.mem.read8(SND))} broken=${hx(b.mem.read8(SND))})`);
  console.log(`  TEETH/state-1: caught — first game-visible diff at ${hx(bad.addr)} ` +
    `(oracle=${bad.a} broken=${bad.b}); 0x6085 ${hx(a.mem.read8(SND))}->${hx(b.mem.read8(SND))}`);
});
