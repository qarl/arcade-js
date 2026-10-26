// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runHitEffectInsteadOfPlay (ROM 0x1E8C) — the per-frame gate on the hit-effect latch
 * (0x6350). Latch clear: return true and the caller runs its ordinary per-frame gameplay
 * cascade. Latch set: run one beat of the effect through dispatchEffectSequenceStep (ROM 0x1E96),
 * then answer false through the skip tail loc_1e94 (ROM 0x1E94), which makes the caller abandon
 * the rest of the frame's update.
 *
 * THE CONTRACT. The real live-out is the caller-skip BOOLEAN (loc_197a consumes it as
 * `if (!runHitEffectInsteadOfPlay(m)) return;`) plus whatever memory the effect beat writes through the router.
 * SP/pc are the dropped stack model: the oracle's skip arm discards the caller's return address
 * and returns a level higher, all inside STACK_SCRATCH, while the rewrite carries that decision
 * in the boolean and touches no stack. So each case compares game-visible RAM (work + sprite +
 * video, minus the stack scratch below the entry SP) AND the boolean, on FRESH clones per side.
 *
 * WHAT THIS FILE ACTUALLY RUNS:
 *
 *   1. REALISM — BOTH ARMS OCCUR NATURALLY, so nothing is crafted for coverage. A plain
 *      4000-frame attract run (no coin, no pokes) with 0x1E8C hooked captures every real
 *      dispatch — 1970 of them, 1532 with the latch clear and 438 with it set — and each is
 *      replayed oracle-vs-idiomatic. The polarity is asserted per entry (true exactly when the
 *      latch read 0), and the entry SP is asserted to sit inside STACK_SCRATCH so excluding that
 *      region cannot mask a real diff.
 *
 *   2. EXHAUSTIVE (latch sweep) — poke the latch to all 256 values identically on both sides of
 *      three real bases: a latch-set one, and two latch-clear ones (one from before any effect
 *      has played, where a poked latch makes BOTH sides refuse in the router, and one from after,
 *      where all 255 nonzero values genuinely run a beat and write memory). This is the only
 *      thing that pins the gate as a zero/nonzero test: play produces only 0 and 1, so the
 *      captures alone cannot tell that reading from "== 1" (teeth (b) demonstrates exactly that
 *      blindness). The sweep asserts the observed shape too — the set of latch values that
 *      proceed is exactly {0}, and the two run-a-beat bases really do run 255 beats each.
 *
 *   3. TEETH — four deliberately-broken twins:
 *      (a) the gate inverted — caught on a real entry, on BOTH the boolean and RAM.
 *      (b) the gate narrowed to "== 1" — INVISIBLE to every captured dispatch (asserted here,
 *          not assumed) and caught by the sweep at latch value 2, on every one of the three
 *          bases. This is what proves the sweep's 256 values are load-bearing rather than
 *          decorative.
 *      (c) the effect beat dropped (skips without advancing the effect) — caught at
 *          EFFECT_SEQ_INNER on a real skip entry.
 *      (d) the skip dropped (runs the beat, then returns true) — RAM is IDENTICAL and only the
 *          boolean diverges, which is what proves the live-out assertion is doing work.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e8c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e8c as oracle } from "../../translated/loc_1e8c.js";
import { runHitEffectInsteadOfPlay as idiomatic } from "../runHitEffectInsteadOfPlay.js";
import { dispatchEffectSequenceStep } from "../dispatchEffectSequenceStep.js";
import { loc_1e94 } from "../loc_1e94.js";
import { Machine } from "../../machine.js";
import { EFFECT_SEQ_STATE, EFFECT_SEQ_INNER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e8c;
const ATTRACT_FRAMES = 4000;
/**
 * The hit-effect latch. Deliberately unnamed in names.js (shared engine scratch — the effect
 * sequence's gate and animateFixedHazardAndReleaseFire's bit0 gate read the same byte), so it is hex here too, exactly as
 * the routine and its siblings keep it.
 */
const EFFECT_LATCH = 0x6350;
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

/**
 * First game-visible RAM difference between two machines, EXCLUDING the stack scratch below the entry SP
 * region. The oracle pushes a return address, pops the caller's, and returns a level up; the
 * rewrite does none of that, so every stack byte is dropped model, not behaviour.
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

/** Replay one captured entry through the oracle and a candidate on independent FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  const retA = oracle(a);
  const retB = candidate(b);
  return { a, b, retA, retB, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run plain attract and clone the machine at every real 0x1E8C dispatch (its caller loc_197a
 * calls it once per frame at ROM 0x197D). The hook delegates to the oracle, so the host run
 * proceeds undisturbed. No pokes and no coin: this is the routine occurring naturally.
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

test("REALISM: real captured 0x1e8c dispatches — game-visible RAM + the skip boolean identical to the oracle", () => {
  const caps = captureDispatches();
  assert.ok(caps.length >= 3, "expected real 0x1e8c dispatches during plain attract");

  let proceed = 0, skip = 0;
  const latchValues = new Map();
  for (const entry of caps) {
    const latch = entry.mem.read8(EFFECT_LATCH);
    latchValues.set(latch, (latchValues.get(latch) || 0) + 1);
    const { bad, retA, retB } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real 0x1e8c entry (latch=${latch} step=${entry.mem.read8(EFFECT_SEQ_STATE)})`,
    );
    // LIVE-OUT: the caller-skip boolean, and its polarity, on both sides.
    assert.equal(retB, retA, `the skip boolean diverged on a real entry (latch=${latch})`);
    assert.equal(retA, latch === 0, `the oracle must proceed exactly when the latch is clear (latch=${latch})`);
    // The oracle returns through the stack; the entry SP must sit inside STACK_SCRATCH so
    // excluding that region cannot mask a real game-visible diff.
    assert.ok(inStack(entry.regs.sp), `entry SP must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`);
    if (retA) proceed++; else skip++;
  }
  // NON-VACUOUS ON BOTH ARMS — this is the claim the header makes, measured rather than assumed.
  assert.ok(proceed > 0 && skip > 0,
    `plain attract must exercise both arms (proceed=${proceed} skip=${skip})`);
  console.log(`  REALISM: ${caps.length} real 0x1e8c dispatch(es) over ${ATTRACT_FRAMES} attract frames — ` +
    `RAM + skip boolean identical; ${proceed} proceed / ${skip} skip; latch values seen: ` +
    [...latchValues.entries()].sort((x, y) => x[0] - y[0]).map(([v, c]) => `${v}x${c}`).join(", "));
});

// -- 2. EXHAUSTIVE (all 256 latch values) -------------------------------------

/**
 * The real captured entries to sweep onto. THREE, because a poked-nonzero latch sends the frame
 * into the effect router, and what the router then does depends on the state the base carries:
 *
 *   "cold"  the first latch-clear entry, from before any effect has ever played: the collision
 *           record the router's step 0 consumes is still all zeros, so a poked latch sends both
 *           sides walking off into unmapped space and BOTH refuse. Identical refusal is a real
 *           agreement, but it compares no interesting RAM — which is why it is not the only base.
 *   "warm"  a latch-clear entry from after an effect has played, so the collision record is live
 *           and all 255 nonzero values genuinely run a step-0 beat and write memory.
 *   "skip"  a real latch-set entry, mid-sequence, where the nonzero values run a divider beat.
 */
function sweepBases(caps) {
  const cold = caps.find((c) => c.mem.read8(EFFECT_LATCH) === 0);
  const firstSkip = caps.findIndex((c) => c.mem.read8(EFFECT_LATCH) !== 0);
  const warm = firstSkip >= 0 ? caps.slice(firstSkip).find((c) => c.mem.read8(EFFECT_LATCH) === 0) : undefined;
  const skip = caps[firstSkip];
  assert.ok(cold, "expected a real latch-clear 0x1e8c entry to sweep from");
  assert.ok(skip, "expected a real latch-set 0x1e8c entry to sweep from");
  assert.ok(warm, "expected a real latch-clear entry from AFTER an effect has played");
  return [{ label: "cold", base: cold }, { label: "warm", base: warm }, { label: "skip", base: skip }];
}

/** Poke the latch to `value` identically on both sides of a base and compare. */
function sweepOne(base, value, candidate) {
  const a = base.clone(), b = base.clone();
  a.mem.write8(EFFECT_LATCH, value);
  b.mem.write8(EFFECT_LATCH, value);
  const o = runGuarded(a, oracle);
  const c = runGuarded(b, candidate);
  if (o.threw !== c.threw) {
    return { value, why: `oracle ${o.threw ? "refused" : "ran"} but candidate ${c.threw ? "refused" : "ran"}` };
  }
  const { bad } = ramDiffMinusStack(o.m, c.m, base.regs.sp);
  if (bad) return { value, why: `RAM diff at ${hx(bad.addr)} (oracle=${bad.a} candidate=${bad.b})`, bad };
  if (o.ret !== c.ret) return { value, why: `the skip boolean diverged (oracle=${o.ret} candidate=${c.ret})` };
  return null;
}

/**
 * Sweep every latch value 0..255 on every base. Returns the first mismatch PER BASE (so a twin
 * caught on one base cannot hide the two others), the set of values that proceed, and the shape
 * each base actually exercised — how many of the 255 nonzero values ran the effect beat versus
 * how many both sides refused on.
 */
function sweepAllValues(bases, candidate) {
  const mismatches = [];
  const shape = [];
  let proceeding = null;
  for (const { label, base } of bases) {
    const seen = [];
    let ran = 0, refused = 0;
    for (let value = 0; value < 256; value++) {
      const a = base.clone();
      a.mem.write8(EFFECT_LATCH, value);
      const o = runGuarded(a, oracle);
      if (o.ret === true) seen.push(value);
      else if (value !== 0) (o.threw ? refused++ : ran++);
      const bad = sweepOne(base, value, candidate);
      if (bad && !mismatches.some((x) => x.label === label)) mismatches.push({ ...bad, label });
    }
    shape.push({ label, ran, refused });
    if (!proceeding) proceeding = seen;
    else assert.deepEqual(seen, proceeding, `the proceeding latch set must not depend on the base (${label})`);
  }
  return { mismatches, proceeding, shape };
}

test("EXHAUSTIVE (latch sweep): runHitEffectInsteadOfPlay == oracle over all 256 latch values on 3 bases, and only 0 proceeds", () => {
  const bases = sweepBases(captureDispatches());
  const { mismatches, proceeding, shape } = sweepAllValues(bases, idiomatic);
  assert.deepEqual(
    mismatches, [],
    mismatches.length ? `mismatch at latch ${mismatches[0].value} (${mismatches[0].label} base): ${mismatches[0].why}` : "",
  );
  assert.deepEqual(proceeding, [0], `only a clear latch may proceed (got ${proceeding.join(",")})`);
  // COVERAGE, STATED NOT IMPLIED: the cold base's nonzero values are identical REFUSALS, so the
  // interesting RAM comparison is the warm and skip bases — both must actually run beats.
  const byLabel = Object.fromEntries(shape.map((s) => [s.label, s]));
  assert.ok(byLabel.warm.ran === 255 && byLabel.skip.ran === 255,
    `the warm and skip bases must run an effect beat on all 255 nonzero latch values (${JSON.stringify(shape)})`);
  console.log("  EXHAUSTIVE: all 256 latch values identical to the oracle on 3 real bases; exactly one " +
    `value proceeds (0). Per base, of the 255 nonzero values: ` +
    shape.map((s) => `${s.label} ran ${s.ran} / both-refused ${s.refused}`).join("; "));
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): the gate inverted — plays the effect when nothing is armed, and vice versa. */
const invertedGate = (m) => {
  if (m.mem.read8(EFFECT_LATCH) !== 0) return true;
  dispatchEffectSequenceStep(m);
  return loc_1e94(m);
};
/** Twin (b): the gate narrowed to "== 1" — indistinguishable in play, wrong on any other value. */
const equalsOneGate = (m) => {
  if (m.mem.read8(EFFECT_LATCH) !== 1) return true;
  dispatchEffectSequenceStep(m);
  return loc_1e94(m);
};
/** Twin (c): skips the caller but never advances the effect. */
const droppedBeat = (m) => {
  if (m.mem.read8(EFFECT_LATCH) === 0) return true;
  return loc_1e94(m);
};
/** Twin (d): advances the effect but lets the caller run its cascade anyway. */
const droppedSkip = (m) => {
  if (m.mem.read8(EFFECT_LATCH) === 0) return true;
  dispatchEffectSequenceStep(m);
  return true;
};

test("TEETH (gate inverted): CAUGHT on a real skip entry — on the boolean and in RAM", () => {
  const skipEntry = captureDispatches().find((c) => c.mem.read8(EFFECT_LATCH) !== 0);
  assert.ok(skipEntry, "expected a real latch-set entry");

  const { bad, retA, retB } = replay(skipEntry, invertedGate);
  assert.notEqual(bad, null, "the replay FAILED to catch an inverted gate — it is worthless");
  assert.notEqual(retB, retA, "the inverted gate must also diverge on the caller-skip boolean");
  console.log(`  TEETH/inverted: caught — boolean ${retA}->${retB}, first RAM diff at ${hx(bad.addr)} ` +
    `(oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (gate narrowed to == 1): INVISIBLE to every captured dispatch, CAUGHT by the sweep at latch 2", () => {
  const caps = captureDispatches();
  // The blindness is measured, not assumed: play only ever puts 0 or 1 in the latch, so every
  // captured entry agrees with the twin. This is precisely why the exhaustive sweep exists.
  for (const entry of caps) {
    const latch = entry.mem.read8(EFFECT_LATCH);
    assert.ok(latch === 0 || latch === 1, `attract produced latch value ${latch}; the blindness claim needs re-deriving`);
    const { bad, retA, retB } = replay(entry, equalsOneGate);
    assert.equal(bad, null, "the captures were expected to be blind to the == 1 twin");
    assert.equal(retB, retA, "the captures were expected to be blind to the == 1 twin");
  }

  const { mismatches } = sweepAllValues(sweepBases(caps), equalsOneGate);
  assert.equal(mismatches.length, 3, "every sweep base must catch the == 1 gate — otherwise a base is decorative");
  for (const mm of mismatches) {
    assert.equal(mm.value, 2, `expected the first catch at latch 2 on the ${mm.label} base, got ${mm.value}`);
  }
  console.log(`  TEETH/==1: ${caps.length} captured dispatches are all blind to it (latch is only ever 0 or 1 in ` +
    `play); the sweep catches it at latch 2 on every base — ` +
    mismatches.map((mm) => `${mm.label}: ${mm.why}`).join(" | "));
});

test("TEETH (effect beat dropped): CAUGHT at EFFECT_SEQ_INNER on a real skip entry", () => {
  // An entry whose current step is one of the two dividers, so the beat's tell is the inner
  // counter ticking down.
  const beat = captureDispatches().find(
    (c) => c.mem.read8(EFFECT_LATCH) !== 0 && [1, 2].includes(c.mem.read8(EFFECT_SEQ_STATE)),
  );
  assert.ok(beat, "expected a real latch-set entry on effect step 1 or 2");

  const { a, b, bad, retA, retB } = replay(beat, droppedBeat);
  assert.notEqual(bad, null, "the replay FAILED to catch a dropped effect beat — it is worthless");
  assert.equal(bad.addr, EFFECT_SEQ_INNER, `expected the caught diff at ${hx(EFFECT_SEQ_INNER)}, got ${hx(bad.addr)}`);
  assert.equal(retB, retA, "the dropped beat still skips, so the boolean alone cannot catch it");
  console.log(`  TEETH/no-beat: caught at ${hx(EFFECT_SEQ_INNER)} — the effect's inner divider stays at ` +
    `${b.mem.read8(EFFECT_SEQ_INNER)} instead of ticking to ${a.mem.read8(EFFECT_SEQ_INNER)}`);
});

test("TEETH (skip dropped): RAM is IDENTICAL and only the live-out boolean catches it", () => {
  const skipEntry = captureDispatches().find((c) => c.mem.read8(EFFECT_LATCH) !== 0);
  assert.ok(skipEntry, "expected a real latch-set entry");

  const { bad, retA, retB } = replay(skipEntry, droppedSkip);
  assert.equal(bad, null, "this twin only breaks control flow; a RAM diff here means the case is mis-built");
  assert.notEqual(retB, retA, "the RETURN VALUE assertion FAILED to catch a skip that does not skip — " +
    "a RAM-only gate would pass this twin, and the caller would run a frame of gameplay under a live effect");
  console.log(`  TEETH/no-skip: RAM identical, caught purely on the live-out — oracle=${retA} broken=${retB}`);
});
