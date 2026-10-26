// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchEffectSequenceStep (ROM 0x1E96) — the router for the effect-sequence step machine
 * held in EFFECT_SEQ_STATE (0x6345). It reads that step byte and hands the frame to one of three
 * handlers: step 0 -> buildEffectSprite (build the sprite + cue the sound), step 1 ->
 * flashEffectSpriteThenAdvanceSequence (flash the tile), step 2 ->
 * animateEffectSpriteThenRearmEffect (march the tile, then tear down and re-arm).
 *
 * dispatchEffectSequenceStep writes no memory itself; every visible byte is the chosen handler's. Its return value
 * is undefined on every path on both sides (all three handlers return nothing, and the caller
 * runHitEffectInsteadOfPlay discards the result and takes its own skip decision), so the return is asserted
 * directly and no register or flag is a live-out. SP/pc are the dropped stack model — the
 * oracle walks the jump table through the stack and returns through its own chain, all inside
 * STACK_SCRATCH. The contract is therefore memory-equivalence on RAM - the stack scratch below the entry SP plus the
 * return value, on a FRESH clone per case (the handlers write memory and cue sounds):
 *
 *   1. REALISM — the routine is REACHABLE NATURALLY: hook 0x1E96 in a plain attract run (no
 *      pokes, no coin) and clone at each real dispatch. 4000 frames yield 438 of them spanning
 *      every reachable step (6 at step 0, 180 at step 1, 252 at step 2). Each is replayed
 *      oracle-vs-idiomatic on independent fresh clones; every game-visible byte and the return
 *      value must match. The oracle's entry SP is asserted to sit inside STACK_SCRATCH so
 *      excluding that region cannot mask a real diff.
 *
 *   2. EXHAUSTIVE (step sweep) — poke EFFECT_SEQ_STATE to all 256 values identically on both
 *      sides of a real base. This covers the three live steps, the three +128 aliases the
 *      oracle's eight-bit slot arithmetic produces (128/129/130 select steps 0/1/2), and the
 *      250 states that run off the three-entry table — where both sides must throw AND leave
 *      identical game-visible RAM. The sweep asserts the observed shape too: exactly
 *      {0,1,2,128,129,130} dispatch, everything else refuses.
 *
 *   3. TEETH — three deliberately-broken twins, each caught at a named cell:
 *      (a) the step-0 one-shot dropped to a no-op — caught on a real step-0 entry, and named:
 *          the sequence never advances (EFFECT_SEQ_STATE stays 0) and the effect's priority
 *          sound is never cued (SND_PRIORITY).
 *      (b) steps 1 and 2 swapped — caught on a real BEAT entry (the divider is at 1, so the
 *          two handlers reload EFFECT_SEQ_INNER to different values), named at 0x6346.
 *      (c) the +128 alias selection dropped (raw step index instead of the low seven bits) —
 *          caught by the exhaustive sweep at state 128, where the oracle dispatches step 0 and
 *          the twin refuses. This is what proves the sweep's alias coverage is not decorative.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e96.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e96 as oracle } from "../../translated/loc_1e96.js";
import { dispatchEffectSequenceStep as idiomatic } from "../dispatchEffectSequenceStep.js";
import { buildEffectSprite } from "../buildEffectSprite.js"; // idiomatic handlers, for the teeth twins
import { flashEffectSpriteThenAdvanceSequence } from "../flashEffectSpriteThenAdvanceSequence.js";
import { animateEffectSpriteThenRearmEffect } from "../animateEffectSpriteThenRearmEffect.js";
import { Machine } from "../../machine.js";
import {
  EFFECT_SEQ_STATE,
  EFFECT_SEQ_INNER,
  SND_PRIORITY,
  STACK_SCRATCH,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e96;
const ATTRACT_FRAMES = 4000;
/** The steps the oracle's three-entry table can reach, including the eight-bit +128 aliases. */
const DISPATCHING_STATES = [0, 1, 2, 128, 129, 130];
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * First game-visible RAM difference between two machines, EXCLUDING the stack scratch below the entry SP
 * region (the memory-equivalence contract is RAM - the stack scratch below the entry SP; SP/pc are the dropped stack
 * model — the oracle threads the jump table and its return chain through the stack, the
 * idiomatic direct calls do not, and no caller consumes either).
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
  const retA = oracle(a);
  const retB = candidate(b);
  return { a, b, retA, retB, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run plain attract and clone the machine at each real 0x1E96 dispatch (runHitEffectInsteadOfPlay calls it once
 * per frame while an effect is armed). Delegates to the oracle so the host run proceeds
 * undisturbed. No pokes and no coin: this is the routine occurring naturally.
 */
let CAPTURED = null;
function captureDispatches() {
  if (CAPTURED) return CAPTURED;
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { caps.push(mm.clone()); return oracle(mm); }]]);
  new Machine(ROM, { overrides: snap }).runFrames(ATTRACT_FRAMES);
  CAPTURED = caps;
  return caps;
}

/** Run a candidate on a clone, reporting either its return value or the error it refused with. */
function runGuarded(entry, candidate) {
  const m = entry.clone();
  try {
    return { m, ret: candidate(m), threw: false };
  } catch (e) {
    return { m, ret: undefined, threw: true, err: e };
  }
}

// -- 1. REALISM (real captured dispatches from plain attract) ------------------

test("REALISM: real captured 0x1e96 dispatches — game-visible RAM + return identical to the oracle", () => {
  const caps = captureDispatches();
  assert.ok(caps.length >= 3, "expected real 0x1e96 dispatches during plain attract");

  const stepsSeen = new Map();
  for (const entry of caps) {
    const state = entry.mem.read8(EFFECT_SEQ_STATE);
    const { bad, retA, retB } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real 0x1e96 entry (step=${state} SP=${hx(entry.regs.sp)})`,
    );
    // LIVE-OUT: the return value. Both sides return nothing on every path.
    assert.equal(retB, retA, `return value diverged on a real step-${state} entry`);
    assert.equal(retA, undefined, "the oracle returns nothing — the caller consumes no result");
    // The oracle walks the table through the stack; the entry SP must sit inside STACK_SCRATCH
    // so excluding that region cannot mask a real game-visible diff.
    assert.ok(
      inStack(entry.regs.sp),
      `entry SP must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    stepsSeen.set(state, (stepsSeen.get(state) || 0) + 1);
  }
  assert.ok(
    stepsSeen.has(0) && stepsSeen.has(1) && stepsSeen.has(2),
    `plain attract must exercise all three steps (saw ${[...stepsSeen.keys()].sort().join(",")})`,
  );
  console.log(`  REALISM: ${caps.length} real 0x1e96 dispatch(es) over ${ATTRACT_FRAMES} attract frames — ` +
    `RAM + return identical; steps seen: ` +
    [...stepsSeen.entries()].sort((x, y) => x[0] - y[0]).map(([s, c]) => `${s}x${c}`).join(", "));
});

// -- 2. EXHAUSTIVE (all 256 step values) --------------------------------------

/**
 * The real captured entries to sweep onto. TWO are needed, because which step ran is not
 * observable from every entry:
 *
 *   "build"  a genuine step-0 dispatch, so the collision record the step-0 handler consumes
 *            (which array was hit, its stride, the hit index) is live and in-distribution
 *            rather than a stale leftover.
 *   "beat"   an entry whose fast divider is about to drain. Steps 1 and 2 are indistinguishable
 *            on a non-beat entry — both just tick the divider down — so a sweep over build-only
 *            bases is BLIND to which of the two ran. On a beat they reload the divider to
 *            different values and drive the sprite cell differently.
 */
function sweepBases(caps) {
  const build = caps.find((c) => c.mem.read8(EFFECT_SEQ_STATE) === 0);
  const beat = caps.find((c) => c.mem.read8(EFFECT_SEQ_INNER) === 1);
  assert.ok(build, "expected a real step-0 0x1e96 entry to sweep from");
  assert.ok(beat, "expected a real 0x1e96 entry on a beat (EFFECT_SEQ_INNER == 1) to sweep from");
  return [{ label: "build", base: build }, { label: "beat", base: beat }];
}

/**
 * Poke EFFECT_SEQ_STATE to `state` identically on both sides and compare. Returns a mismatch
 * when the two sides disagree on whether they dispatch at all, or on game-visible RAM, or on
 * the return value.
 */
function sweepOne(base, state, candidate) {
  const a = base.clone(), b = base.clone();
  a.mem.write8(EFFECT_SEQ_STATE, state);
  b.mem.write8(EFFECT_SEQ_STATE, state);
  const o = runGuarded(a, oracle);
  const c = runGuarded(b, candidate);
  if (o.threw !== c.threw) {
    return { state, why: `oracle ${o.threw ? "refused" : "dispatched"} but candidate ${c.threw ? "refused" : "dispatched"}` };
  }
  const { bad } = ramDiffMinusStack(o.m, c.m, base.regs.sp);
  if (bad) return { state, why: `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} candidate=${bad.b})`, bad };
  if (o.ret !== c.ret) return { state, why: `return diverged (oracle=${o.ret} candidate=${c.ret})` };
  return null;
}

/** Sweep every step value 0..255 on every base; report the first mismatch and what dispatched. */
function sweepAllStates(bases, candidate) {
  let mismatch = null;
  let dispatched = null;
  for (const { label, base } of bases) {
    const seen = [];
    for (let state = 0; state < 256; state++) {
      const a = base.clone();
      a.mem.write8(EFFECT_SEQ_STATE, state);
      if (!runGuarded(a, oracle).threw) seen.push(state);
      const bad = sweepOne(base, state, candidate);
      if (bad && !mismatch) mismatch = { ...bad, label };
    }
    if (!dispatched) dispatched = seen;
    else assert.deepEqual(seen, dispatched, `the dispatching step set must not depend on the base (${label})`);
  }
  return { mismatch, dispatched };
}

test("EXHAUSTIVE (step sweep): dispatchEffectSequenceStep == oracle over all 256 EFFECT_SEQ_STATE values", () => {
  const bases = sweepBases(captureDispatches());
  const { mismatch, dispatched } = sweepAllStates(bases, idiomatic);
  assert.equal(mismatch, null, mismatch && `mismatch at step ${mismatch.state} (${mismatch.label} base): ${mismatch.why}`);
  assert.deepEqual(
    dispatched,
    DISPATCHING_STATES,
    `only steps 0-2 and their +128 aliases may dispatch (got ${dispatched.join(",")})`,
  );
  console.log(`  EXHAUSTIVE: all 256 steps identical to the oracle on both the build and beat bases; ` +
    `dispatching steps = ${dispatched.join(", ")} (the rest refuse on both sides, with identical RAM)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Router builder: dispatch on EFFECT_SEQ_STATE through a supplied step table, else refuse. */
function makeRouter(steps, { alias = true } = {}) {
  return (m) => {
    const state = m.mem.read8(EFFECT_SEQ_STATE);
    const step = steps[alias ? state & 0x7f : state];
    if (step) return step(m);
    throw new Error("off the end of the step table");
  };
}

const noop = () => {};
// Twin (a): the step-0 one-shot dropped — never builds the sprite, cues the sound, or advances.
const brokenBuild = makeRouter([noop, flashEffectSpriteThenAdvanceSequence, animateEffectSpriteThenRearmEffect]);
// Twin (b): steps 1 and 2 swapped — the flash and the march trade places.
const swappedSteps = makeRouter([buildEffectSprite, animateEffectSpriteThenRearmEffect, flashEffectSpriteThenAdvanceSequence]);
// Twin (c): the +128 alias selection dropped — the raw step indexes the table.
const noAlias = makeRouter(
  [buildEffectSprite, flashEffectSpriteThenAdvanceSequence, animateEffectSpriteThenRearmEffect],
  { alias: false },
);

test("TEETH (step-0 no-op): the dropped effect one-shot is CAUGHT, at EFFECT_SEQ_STATE and SND_PRIORITY", () => {
  const step0 = captureDispatches().find((c) => c.mem.read8(EFFECT_SEQ_STATE) === 0);
  assert.ok(step0, "expected a real step-0 (build) entry");

  const { a, b, bad } = replay(step0, brokenBuild);
  assert.notEqual(bad, null, "the replay FAILED to catch a dropped step-0 one-shot — it is worthless");
  // Name the divergence: the sequence never advances and the effect's sound is never cued.
  assert.notEqual(a.mem.read8(EFFECT_SEQ_STATE), b.mem.read8(EFFECT_SEQ_STATE),
    "the dropped one-shot must leave EFFECT_SEQ_STATE unadvanced");
  assert.notEqual(a.mem.read8(SND_PRIORITY), b.mem.read8(SND_PRIORITY),
    "the dropped one-shot must leave the effect's priority sound uncued");
  console.log(`  TEETH/step-0: caught — first diff at ${hx(bad.addr)} (oracle=${bad.a} broken=${bad.b}); ` +
    `EFFECT_SEQ_STATE ${a.mem.read8(EFFECT_SEQ_STATE)}->${b.mem.read8(EFFECT_SEQ_STATE)}, ` +
    `SND_PRIORITY ${hx(a.mem.read8(SND_PRIORITY))}->${hx(b.mem.read8(SND_PRIORITY))}`);
});

test("TEETH (steps 1/2 swapped): the wrong step on a beat entry is CAUGHT, at EFFECT_SEQ_INNER", () => {
  // A BEAT entry: the fast divider is about to drain, which is where the two steps differ
  // (they reload EFFECT_SEQ_INNER to different values and drive the sprite cell differently).
  const beat = captureDispatches().find(
    (c) => c.mem.read8(EFFECT_SEQ_STATE) === 1 && c.mem.read8(EFFECT_SEQ_INNER) === 1,
  );
  assert.ok(beat, "expected a real step-1 entry on a beat (EFFECT_SEQ_INNER == 1)");

  const { bad } = replay(beat, swappedSteps);
  assert.notEqual(bad, null, "the replay FAILED to catch swapped steps — it is worthless");
  assert.equal(bad.addr, EFFECT_SEQ_INNER, `expected the caught diff at ${hx(EFFECT_SEQ_INNER)}, got ${hx(bad.addr)}`);

  // The exhaustive sweep must catch it independently — that is what the beat base is FOR
  // (a build-only base cannot tell steps 1 and 2 apart).
  const { mismatch } = sweepAllStates(sweepBases(captureDispatches()), swappedSteps);
  assert.notEqual(mismatch, null, "the exhaustive sweep FAILED to catch swapped steps — the beat base is not biting");
  console.log(`  TEETH/swap: caught at ${hx(EFFECT_SEQ_INNER)} (oracle=${bad.a} broken=${bad.b}); ` +
    `sweep also caught it at step ${mismatch.state} on the ${mismatch.label} base`);
});

test("TEETH (alias dropped): the raw step index is CAUGHT by the exhaustive sweep at step 128", () => {
  const { mismatch } = sweepAllStates(sweepBases(captureDispatches()), noAlias);
  assert.notEqual(mismatch, null, "the exhaustive sweep FAILED to catch a dropped alias — it is worthless");
  assert.equal(mismatch.state, 128, `expected the first catch at step 128, got ${mismatch.state}`);
  console.log(`  TEETH/alias: caught at step 128 — ${mismatch.why}`);
});
