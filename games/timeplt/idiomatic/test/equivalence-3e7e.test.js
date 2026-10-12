// SPDX-License-Identifier: GPL-3.0-only
/**
 * animateFixedShapeCycle — memory-equivalent to the frozen oracle at ROM 0x3E7E.
 *
 * WHAT IT IS. Two bytes written into a sprite entry: a shape code taken from a free-running cell,
 * halved and reduced to one of eight consecutive codes, and a fixed attribute byte. It reads nothing
 * of the object it is given, so the same tick gives every entry the same shape.
 *
 * ★ NO UNDIVERTED TAPE REACHES THIS ENTRY, and the UNREACHED arm asserts it: the shared
 *   coin-then-start tape, the same tape turning, and undriven attract dispatch it ZERO times in
 *   2000 frames. Its caller tests the era index against one value, so the whole corpus here is
 *   DRIVEN PLAY WITH THE ERA HELD at that value, poked once per frame in the frame service. The
 *   game then dispatches this entry itself, hundreds of times, off its own object population.
 *   That is an A/B with a control: ONE cell decides whether the same session reaches it at all.
 *
 * GATE: strict unit-capture off an era-held session, two era-held sessions replayed at every
 *   dispatch, an exhaustive sweep of the clock cell, and a whole-machine replay. Holes stated:
 *
 *   1. UNREACHED — the three undriven sessions' counts, and the era-held session's, side by side.
 *   2. EQUAL at the real dispatch — RAM byte-identical.
 *   3. NOT VACUOUS — a no-op FAILS that same diff.
 *   4. EXCLUDED — over the whole clock sweep nothing outside the scratch set moves. The set is an
 *      upper BOUND on the divergence, not a measurement of it: a rewrite that leaves fewer of
 *      those registers dirty is strictly better and still passes.
 *   5. UNIFORM CORPUS — how many sprite bases and how many distinct clock values the era-held
 *      sessions present, asserted as counts.
 *   6. CORPUS — every dispatch of two era-held sessions.
 *   7. EXHAUSTIVE — the clock cell swept 0..255, which is the entry's whole input space bar the
 *      sprite base, so the eight-frame cycle is covered end to end rather than sampled.
 *   8. WHOLE-MACHINE — an era-held session with the rewrite wired, diffed every frame.
 *   9. TEETH — eight twins, each with an exact catch count over the sweep and per session. Several
 *      are caught on FEWER real dispatches than the sweep would suggest, because a slot that
 *      already holds the byte a twin writes cannot show the difference; the counts say so.
 *
 * HOLE: the sprite base is never varied by a crafted arm. The corpus arm reports how many bases
 * the era-held sessions present, and that is the whole coverage of them.
 * HOLE: the era is HELD rather than reached by play, so nothing here says the object population at
 * that era in a real game looks like the one this session produces.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3e7e.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { animateFixedShapeCycle } from "../animateFixedShapeCycle.js";
import { loc_3e7e as oracle } from "../../translated/loc_3e7e.js";
import { ERA_INDEX, FRAME_TICK } from "../names.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3e7e;

const SHAPE_SLOT = 1;
const CONTROL_SLOT = 48;
const FIRST_SHAPE = 64;
const SHAPES = 8;
const CONTROL_BYTE = 68;

/** The one era value the caller tests for, and the once-per-frame service the poke rides in. */
const GATING_ERA = 4;
const FRAME_SERVICE = 0x0038;

/** The scratch set: an upper bound on what may diverge, not a measurement of what does. */
const MOVED = ["a", "f", "sp"];
const HELD = ["b", "c", "d", "e", "h", "l", "ix", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyByte = Array.from({ length: 256 }, (_unused, v) => v);

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const UNDRIVEN = [["shared", {}], ["attract", { tape: [] }], ["turning", { tape: turnTape() }]];

const frameService = buildRoutines().get(FRAME_SERVICE);

/**
 * A session with the era index held at the value this entry's caller tests for. The poke goes in
 * the once-per-frame service, so the game's own dispatcher reaches the entry; nothing about the
 * entry itself is touched, and the whole-machine baseline is poked identically.
 */
function eraHeld(opts) {
  return (overrides) => {
    const merged = new Map(overrides ?? []);
    const inner = merged.get(FRAME_SERVICE) ?? frameService;
    merged.set(FRAME_SERVICE, (mm, ...args) => {
      mm.mem8[ERA_INDEX] = GATING_ERA;
      return inner(mm, ...args);
    });
    return makeMachine(merged, opts);
  };
}

const heldAttract = eraHeld({ tape: [] });
const heldShared = eraHeld({});

const SESSIONS = [["held-attract", heldAttract], ["held-shared", heldShared]];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { "held-attract": 325, "held-shared": 558 };

const shapeAt = (m) => (m.regs.iy + SHAPE_SLOT) & 0xffff;
const controlAt = (m) => (m.regs.iy + CONTROL_SLOT) & 0xffff;
const WRITTEN = [shapeAt, controlAt];

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    heldAttract,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_FRAMES },
  );
}

function entryState() {
  if (entry === null) gate(animateFixedShapeCycle);
  return entry;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

/** A real captured machine with the clock cell forced, which is the crafted-entry idiom. */
function craft(clock) {
  const m = entryState().clone();
  m.mem8[FRAME_TICK] = clock;
  return m;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const bases = new Set();
  const clocks = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      bases.add(mm.regs.iy);
      clocks.add(mm.mem8[FRAME_TICK]);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, bases, clocks };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, animateFixedShapeCycle) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

const replay = (candidate) =>
  wholeMachineEquivalence(heldAttract, WHOLE_FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the clock is used whole, so the cycle runs at twice the pace. */
function brokenNotHalved(m) {
  const { mem8, regs } = m;
  mem8[regs.iy + SHAPE_SLOT] = FIRST_SHAPE + (mem8[FRAME_TICK] & (SHAPES - 1));
  mem8[regs.iy + CONTROL_SLOT] = CONTROL_BYTE;
}

/** BUG: the cycle is four frames long instead of eight. */
function brokenShortCycle(m) {
  const { mem8, regs } = m;
  mem8[regs.iy + SHAPE_SLOT] = FIRST_SHAPE + ((mem8[FRAME_TICK] >> 1) & 3);
  mem8[regs.iy + CONTROL_SLOT] = CONTROL_BYTE;
}

/** BUG: the shape base is one out, so every frame of the cycle is the wrong shape. */
function brokenShapeBaseOffByOne(m) {
  const { mem8, regs } = m;
  mem8[regs.iy + SHAPE_SLOT] = FIRST_SHAPE + 1 + ((mem8[FRAME_TICK] >> 1) & (SHAPES - 1));
  mem8[regs.iy + CONTROL_SLOT] = CONTROL_BYTE;
}

/** BUG: the control byte is one out. */
function brokenControlOffByOne(m) {
  const { mem8, regs } = m;
  mem8[regs.iy + SHAPE_SLOT] = FIRST_SHAPE + ((mem8[FRAME_TICK] >> 1) & (SHAPES - 1));
  mem8[regs.iy + CONTROL_SLOT] = CONTROL_BYTE + 1;
}

/** BUG: the control byte is never written, so the entry keeps whatever it had. */
function brokenControlSkipped(m) {
  const { mem8, regs } = m;
  mem8[regs.iy + SHAPE_SLOT] = FIRST_SHAPE + ((mem8[FRAME_TICK] >> 1) & (SHAPES - 1));
}

/** BUG: the shape is never written. */
function brokenShapeSkipped(m) {
  m.mem8[m.regs.iy + CONTROL_SLOT] = CONTROL_BYTE;
}

/** BUG: the two bytes go to each other's slots. */
function brokenSlotsSwapped(m) {
  const { mem8, regs } = m;
  mem8[regs.iy + CONTROL_SLOT] = FIRST_SHAPE + ((mem8[FRAME_TICK] >> 1) & (SHAPES - 1));
  mem8[regs.iy + SHAPE_SLOT] = CONTROL_BYTE;
}

const TWINS = [
  ["no-op", brokenNoOp, 256, [164, 279], true],
  ["not-halved", brokenNotHalved, 224, [285, 489], true],
  ["short-cycle", brokenShortCycle, 128, [162, 278], true],
  ["shape-base-off-by-one", brokenShapeBaseOffByOne, 256, [325, 558], true],
  ["control-off-by-one", brokenControlOffByOne, 256, [325, 558], true],
  ["control-skipped", brokenControlSkipped, 256, [3, 2], true],
  ["shape-skipped", brokenShapeSkipped, 256, [164, 279], true],
  ["slots-swapped", brokenSlotsSwapped, 224, [285, 488], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: only an era-held session dispatches this entry", { skip }, () => {
  const counts = [];
  for (const [label, opts] of UNDRIVEN) {
    let dispatches = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => (dispatches++, oracle(mm))]]), opts);
    const ran = m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} tape stopped early: ${m.stoppedBy}`);
    assert.equal(ran.length, CORPUS_FRAMES, `the ${label} tape ran short`);
    counts.push(`${label} ${dispatches}`);
    assert.equal(dispatches, 0, `the ${label} tape now reaches this entry without the era being ` +
      "held, so it is no longer era-gated and the corpus should be rebuilt around that tape");
  }
  const held = sessions();
  console.log(`  UNREACHED: ${counts.join(", ")}; era-held ${held.map((s) => s.dispatches).join("/")}`);
  for (const s of held) {
    assert.ok(s.dispatches > 0, `the ${s.label} session must reach it, or the A/B has no positive ` +
      "arm and the era is not what gates this entry");
  }
});

test("EQUAL at the real dispatch: animateFixedShapeCycle == oracle on RAM", { skip }, () => {
  const r = gate(animateFixedShapeCycle);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  const e = entryState();
  console.log(`  EQUAL: entry base ${hex4(e.regs.iy)} clock ${e.mem8[FRAME_TICK]}; identical`);
});

test("NOT VACUOUS: a no-op candidate FAILS the RAM diff at the real dispatch", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the RAM diff passed a candidate that does nothing, so RAM is NOT " +
    "this gate and the whole file must be re-derived");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole clock sweep", { skip }, () => {
  const moved = new Set();
  for (const clock of everyByte) {
    const a = craft(clock);
    const b = a.clone();
    oracle(a);
    animateFixedShapeCycle(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const at of WRITTEN) assert.equal(a.mem8[at(a)], b.mem8[at(b)], `live-out ${hex4(at(a))}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  const unexpected = REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  for (const k of HELD) assert.ok(!moved.has(k), `a register a caller may rely on moved (${k})`);
});

test("UNIFORM CORPUS: what the era-held sessions present", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.bases.size} bases / ${s.clocks.size} clocks`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const clocks = new Set(seen.flatMap((s) => [...s.clocks]));
  assert.ok(clocks.size > 1, "every real dispatch arrives on the same clock value, so the corpus " +
    "cannot see the cycle at all and only the crafted sweep holds it");
});

test("CORPUS: every dispatch of both era-held sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, RAM identical on each`);
});

test("EXHAUSTIVE: the clock cell swept 0..255 behaves as the oracle", { skip }, () => {
  const shapes = new Set();
  for (const clock of everyByte) {
    const d = unitDiff(animateFixedShapeCycle, craft(clock));
    assert.equal(d, null, `clock ${clock}: ${show(d)}`);
    const after = craft(clock);
    oracle(after);
    shapes.add(after.mem8[shapeAt(after)]);
  }
  console.log(`  EXHAUSTIVE: 256 clock values identical; ${shapes.size} distinct shapes`);
  assert.equal(shapes.size, SHAPES, "the sweep no longer covers a whole cycle of shapes");
});

test("WHOLE-MACHINE: an era-held session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(animateFixedShapeCycle);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches, identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, sweepCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of clock values`, { skip }, () => {
    const caught = everyByte.filter((c) => unitDiff(twin, craft(c)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of 256 clock values`);
    assert.equal(caught, sweepCaught, `the ${label} twin's clock catch count moved`);
    assert.ok(caught > 0, `the clock sweep missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const w = replay(twin);
    console.log(
      `  TEETH/${label}: whole machine ${w.equal ? "is BLIND, as recorded" : `forks at frame ${w.frame}`}`,
    );
    assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the twin never dispatched");
    assert.equal(w.equal, !wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
