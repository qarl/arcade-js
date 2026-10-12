// SPDX-License-Identifier: GPL-3.0-only
/**
 * velocityForHeadingAtSecondFastestSpeed — memory-equivalent to the frozen oracle at ROM 0x5965.
 *
 * WHAT IT IS. Two instructions: load a fixed table pointer, then tail-jump to the velocity lookup
 * at 0x596E, which IS ALREADY DECOMPILED — so the rewrite calls velocityForHeading directly with
 * the table as an argument, and dissolving that transfer belongs to this caller's unit. The whole
 * content of the routine is therefore the CHOICE OF TABLE plus the fact that the pointer a caller
 * was already holding is thrown away.
 *
 * ★ NO TAPE REACHES THIS ENTRY AT ALL, AND THE TAPE REACH ARM ASSERTS IT. Measured: the shared
 *   coin-then-start tape, undriven attract, and both of the turning tapes below dispatch it ZERO
 *   times in 1500 frames. The routine that picks between the shims reads the era index, and no
 *   tape gets the player out of the first era inside the budget. So every session here is DRIVEN
 *   PLAY WITH THE ERA INDEX POKED to a value that selects this shim, held only for the length of
 *   the routine that reads it and restored on the way out. The game then dispatches this entry
 *   itself. That is the A/B with a control: ONE cell decides whether the same tape reaches this
 *   routine 537 times or not at all.
 *
 * ★ RAM ALONE CANNOT GATE THIS ROUTINE. The lookup writes no memory, so a RAM diff reports
 *   identical for the correct arm, for every twin, and for a bare no-op. The BLIND arm asserts
 *   exactly that, and it is the written justification for gating everywhere else on RAM *plus* the
 *   declared live-out {b, c, d, e}.
 *
 * ★ THE TABLE IS THE ONLY THING THIS ENTRY DECIDES, AND NO TAPE CAN VARY IT. Six velocity tables
 *   sit in the ROM whose peak magnitudes climb in even steps — 0x59D7, 0x5C00, 0x5E00, 0x2530,
 *   0x2E3E, 0x08FA — and a shim like this one is a rung on that ladder. A gate that cannot tell
 *   0x2E3E from its NEIGHBOURS is measuring nothing about this file, so the twins named rung-below,
 *   rung-above, bottom-rung and middle-rung hand the same lookup another rung of that ladder — the
 *   first two being the rungs immediately either side — three more hand it a pointer that is no
 *   table at all, and the RUNG LADDER arm re-derives from the table bytes themselves why none of
 *   them can hide.
 *
 * GATE: strict unit-capture, two driven sessions replayed at every dispatch, an exhaustive sweep
 *   of the whole heading space, and a whole-machine replay of driven play. What it exercises,
 *   holes stated:
 *
 *   1. CONTRACT — unitEquivalence at the first real dispatch: RAM identical. `equal` is not
 *      asserted; it folds in the register diff this contract deliberately drops.
 *   2. BLIND — the same call passes a no-op. If it ever fails, the routine writes memory after all
 *      and every arm below that leans on the live-out has to be re-derived.
 *   3. TAPE REACH — the zero-versus-537 A/B above, run rather than recounted.
 *   4. DEAD FIRST DISPATCH — unitEquivalence clones the FIRST entry and no frame budget changes
 *      which one; the test doubles the budget and asserts the same entry comes back.
 *   5. DEGENERATE ENTRY — that entry sits on a heading whose second component is zero, and one of
 *      the twelve twins is INVISIBLE there. The test says which.
 *   6. UNIFORM CORPUS — the corpus varies the heading and nothing else. It presents ONE record base
 *      and ONE incoming pointer, and 119 of the 256 headings are reached by neither tape. The
 *      second tape is not a duplicate of the first: it adds 15 headings the first never produces.
 *   7. CORPUS — both sessions replayed at EVERY dispatch on RAM plus the live-out.
 *   8. EXCLUDED — over the whole sweep the registers that move are exactly {a, f, h, l, sp} and the
 *      live-out never moves.
 *   9. EXHAUSTIVE — all 256 headings crafted off the real entry, which is what covers the band no
 *      tape drives.
 *  10. THE INCOMING POINTER IS IGNORED — a whole session with it forced to a neighbouring rung
 *      before every dispatch is bit-identical to the clean run.
 *  11. LIVE-OUT IS FALSIFIABLE, NOT ARGUED — the dropped registers forced hostile after every
 *      dispatch of a whole session leave no trace, while either half of the declared pair forced
 *      hostile the same way FORKS the run. That second half is the tooth on the instrument.
 *  12. RUNG LADDER — the six tables' peak magnitudes, and the reason a neighbouring rung is caught
 *      everywhere: a single sample DOES match a neighbour at nine near-zero headings, but the
 *      lookup returns a perpendicular PAIR and no heading has both of them matching.
 *  13. WHOLE-MACHINE — driven play with the rewrite wired, diffed every frame against a baseline
 *      poked the same way, and every twin caught there too.
 *  14. TEETH — twelve twins, each declaring the EXACT headings it survives, the exact number of
 *      real dispatches it is caught on in each session, whether the first dispatch can see it, and
 *      a fork of the whole machine.
 *
 * The replay needs a shim. The host engine is cycle-driven and every caller arrives by a transfer
 * that ends in the lookup's own return, so a candidate charging no T-states and not taking that
 * return would move the vblank interrupt and leak two stack bytes per dispatch. The shim pays both,
 * identically for the real arm and for every twin, and its branch-dependent total is checked
 * against the oracle over all 256 headings rather than assumed.
 *
 * NO STACK-SCRATCH WINDOW IS DRAWN, deliberately. The routine writes no RAM, so there is nothing to
 * exclude and the whole-machine diff covers every byte, the stack included.
 *
 * HOLE: ONE object slot. Every dispatch in both sessions arrives on the same record base, so the
 * crafted arms vary the heading read out of that record, never the record it is read from.
 *
 * HOLE: EVERY dispatch in this file is reached through the poke. Nothing here observes the entry
 * being selected by an era the player actually played into, only by an era written under the
 * selector's feet — the poke is the game's own selection input, but it is not natural play.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5965.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { buildRoutines } from "../../routines.js";
import { velocityForHeadingAtSecondFastestSpeed } from "../velocityForHeadingAtSecondFastestSpeed.js";
import { velocityForHeading } from "../velocityForHeading.js";
import { ERA_INDEX } from "../names.js";
import { loc_5965 as oracle } from "../../translated/loc_5965.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x5965;

/** The one table this entry exists to select. */
const VELOCITY_TABLE = 0x2e3e;

/** The whole ladder, slowest first, so the two rungs either side of this one can be named. */
const LADDER = [0x59d7, 0x5c00, 0x5e00, 0x2530, 0x2e3e, 0x08fa];
const RUNG = LADDER.indexOf(VELOCITY_TABLE);
const RUNG_BELOW = LADDER[RUNG - 1];
const RUNG_ABOVE = LADDER[RUNG + 1];
const PEAKS = [206, 231, 256, 281, 306, 331];

/** The headings where every rung holds the same near-zero sample, so one sample cannot separate them. */
const ZERO_CROSSINGS = [62, 63, 64, 65, 67, 190, 191, 192, 193];

/** Two malformed pointers: one entry along, and one BYTE along so each sample straddles two. */
const OFF_BY_ONE_ENTRY = VELOCITY_TABLE + 2;
const MISALIGNED = VELOCITY_TABLE + 1;

const HEADING_CELL = 2;
const HEADINGS = 256;
const QUARTER = HEADINGS / 4;

const LIVE_OUT = ["b", "c", "d", "e"];
const MOVED = ["a", "f", "h", "l", "sp"];

const CORPUS_FRAMES = 1500;
const WHOLE_FRAMES = 1400;

/** The routine that reads the era index and picks between the shims, and the value that picks this one. */
const SELECTOR = 0x1f01;
const SELECTED_ERA = 1;

/**
 * T-states: the two instructions of this entry, then the lookup's straight-line total including
 * its return. Its three branches each cost one less when the carry they test is set.
 */
const THUNK_TSTATES = 20;
const STRAIGHT_LINE = 117;
const RET_TSTATES = 10;

/** The low half of the fixed pointer, which is what decides the lookup's second branch. */
const TABLE_LOW = VELOCITY_TABLE & 0xff;

const IN0 = 0xc300;
const IN1 = 0xc320;
const COIN = 0x01;
const START = 0x08;
const LEFT = 0x01;
const RIGHT = 0x02;
const UP = 0x04;
const DOWN = 0x08;
const FIRE = 0x10;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;
const WEAVE_HOLD = 23;
const WEAVE_FIRST_FRAME = 560;
const WEAVE_PASSES = 5;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const everyHeading = Array.from({ length: HEADINGS }, (_unused, h) => h);
const headingOf = (mm) => mm.mem8[(mm.regs.ix + HEADING_CELL) & 0xffff];
const sampleAt = (m, table, index) => m.mem16[table + 2 * (index & (HEADINGS - 1))];

/** A signed reading of a table sample, so a peak magnitude can be measured rather than assumed. */
const signedAt = (m, table, index) => {
  const v = sampleAt(m, table, index);
  return v & 0x8000 ? v - 0x10000 : v;
};

/** The shared tape with the stick walked once round the compass, holding each bearing a while. */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: COIN, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: START, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: FIRE, dur: WHOLE_FRAMES },
  ];
  const compass = [
    LEFT, LEFT | UP, UP, UP | RIGHT, RIGHT, RIGHT | DOWN,
    DOWN, DOWN | LEFT, LEFT, UP, RIGHT, DOWN,
  ];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

/** A second tape: the compass walked several times over, much faster, and started earlier. */
function weaveTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: COIN, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: START, dur: HOLD },
    { frame: WEAVE_FIRST_FRAME - HOLD, port: IN1, bits: FIRE, dur: WHOLE_FRAMES },
  ];
  const compass = [UP, UP | RIGHT, RIGHT, RIGHT | DOWN, DOWN, DOWN | LEFT, LEFT, LEFT | UP];
  let frame = WEAVE_FIRST_FRAME;
  for (let pass = 0; pass < WEAVE_PASSES; pass++) {
    for (const bits of compass) {
      tape.push({ frame, port: IN1, bits, dur: WEAVE_HOLD });
      frame += WEAVE_HOLD;
    }
  }
  return tape;
}

const selectorRoutine = buildRoutines().get(SELECTOR);

/**
 * A driven session with the era index poked to the value that selects this shim, for exactly the
 * length of the routine that reads it, and put back afterwards. The game's own selector then makes
 * the choice, so the dispatch and the machine state around it are the game's and not the test's.
 */
function eraPoked(overrides, opts) {
  const merged = new Map(overrides ?? []);
  const inner = merged.get(SELECTOR) ?? selectorRoutine;
  merged.set(SELECTOR, (mm, ...args) => {
    const was = mm.mem8[ERA_INDEX];
    mm.mem8[ERA_INDEX] = SELECTED_ERA;
    const r = inner(mm, ...args);
    mm.mem8[ERA_INDEX] = was;
    return r;
  });
  return makeMachine(merged, opts);
}

const turningMachine = (overrides) => eraPoked(overrides, { tape: turnTape() });
const weavingMachine = (overrides) => eraPoked(overrides, { tape: weaveTape() });

const SESSIONS = [
  ["turning", turningMachine],
  ["weaving", weavingMachine],
];

/** Measured; a move in any of these is a finding, not a number to update. */
const DISPATCHES = { turning: 537, weaving: 840 };
const DISTINCT_HEADINGS = { turning: 122, weaving: 96 };

/** How many of the 256 headings NEITHER tape produces, and how many the second tape adds. */
const NEVER_DRIVEN = 119;
const WEAVING_ADDS = 15;

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    turningMachine,
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
  if (entry === null) gate(velocityForHeadingAtSecondFastestSpeed);
  return entry;
}

/** Oracle vs candidate on independent clones, diffed on RAM and then the declared live-out. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return `ram ${hex4(ram.addr ?? 0)}: oracle=${ram.a} candidate=${ram.b}`;
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return `${k}: oracle=${a.regs[k]} candidate=${b.regs[k]}`;
  }
  return null;
}

/** A real captured machine nudged onto one heading, which is the crafted-entry idiom. */
function selector(heading) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + HEADING_CELL) & 0xffff] = heading;
  return m;
}

// ── replaying a whole session, one dispatch at a time ───────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const headings = new Set();
  const pointers = new Set();
  const bases = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      headings.add(headingOf(mm));
      pointers.add(mm.regs.hl);
      bases.add(mm.regs.ix);
      const b = mm.clone();
      const r = oracle(mm);
      candidate(b);
      let diverged = firstStateDiff(mm.dumpState(), b.dumpState(), (o) => mm.stateOffsetToAddr(o)) !== null;
      if (!diverged) for (const k of LIVE_OUT) if (mm.regs[k] !== b.regs[k]) diverged = true;
      if (diverged) caught++;
      return r;
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, headings, pointers, bases };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, velocityForHeadingAtSecondFastestSpeed) }));
  return sessionCache;
}

// ── whole-session hostile-register instruments ──────────────────────────────────────────

/** Two whole driven sessions diffed frame by frame: clean, and one mutated at every dispatch. */
function hostileSession(mutate) {
  const base = turningMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let dispatches = 0;
  const host = turningMachine(new Map([[TARGET, (mm) => {
    dispatches += 1;
    return mutate(mm);
  }]]));
  const hostFrames = host.runFrames(CORPUS_FRAMES);
  const addrs = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) addrs.add(base.stateOffsetToAddr(o));
  }
  return { cells: addrs.size, frames: n, dispatches, stopped: base.stoppedBy ?? host.stoppedBy };
}

const DROPPED = ["a", "f", "h", "l"];

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

function oracleTStates(m) {
  const heading = headingOf(m);
  const doubled = (2 * heading) & 0xff;
  return (
    THUNK_TSTATES +
    STRAIGHT_LINE +
    (heading & 0x80 ? 11 : 12) +
    (doubled + TABLE_LOW > 255 ? 11 : 12) +
    (heading >= QUARTER ? 17 : 12)
  );
}

/** Adapt a candidate to the cycle-driven host: pay the oracle's total, then take the return. */
function hosted(candidate) {
  return (mm) => {
    const total = oracleTStates(mm);
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

function replay(candidate) {
  return wholeMachineEquivalence(
    turningMachine,
    WHOLE_FRAMES,
    new Map([[TARGET, hosted(candidate)]]),
  );
}

// ── the twins ───────────────────────────────────────────────────────────────────────────
// Twelve ways to get this routine wrong. The first is the empty candidate; the next seven hand the
// lookup a different pointer, which is the whole of what this entry decides; the last four break
// the lookup itself, so the gate is not merely trusting that the transfer went somewhere.

/** BUG: does nothing at all — what a gate reading only RAM waves through. */
function brokenNoOp() {}

/** BUG: uses the pointer the caller happened to be holding instead of overriding it. */
function brokenForwardsPointer(m) {
  velocityForHeading(m, m.regs.hl);
}

/** BUG: takes the partner a quarter turn FORWARD, which is the same axis with the sign flipped. */
function brokenQuarterForward(m) {
  m.regs.de = sampleAt(m, VELOCITY_TABLE, headingOf(m));
  m.regs.bc = sampleAt(m, VELOCITY_TABLE, headingOf(m) + QUARTER);
}

/** BUG: steps back a quarter turn without wrapping, so low headings read below the table. */
function brokenUnwrapped(m) {
  m.regs.de = m.mem16[VELOCITY_TABLE + 2 * headingOf(m)];
  m.regs.bc = m.mem16[VELOCITY_TABLE + 2 * headingOf(m) - 2 * QUARTER];
}

/** BUG: hands the two components back the other way round, so the object flies sideways. */
function brokenPairSwapped(m) {
  m.regs.bc = sampleAt(m, VELOCITY_TABLE, headingOf(m));
  m.regs.de = sampleAt(m, VELOCITY_TABLE, headingOf(m) - QUARTER);
}

/** BUG: returns the first component and leaves the second one at whatever it was. */
function brokenSecondDropped(m) {
  m.regs.de = sampleAt(m, VELOCITY_TABLE, headingOf(m));
}

/**
 * Per twin: the headings it SURVIVES over the sweep, whether the first real dispatch can see it,
 * and its catch count in each session. Every number is measured, and asserted as a partition or an
 * equality rather than as "more than none", so a twin caught on the WRONG set fails as loudly as
 * one that is not caught at all.
 */
const TWINS = [
  ["no-op", brokenNoOp, [], true, [537, 840]],
  ["forwards-the-pointer", brokenForwardsPointer, [], true, [537, 840]],
  ["rung-below", (m) => velocityForHeading(m, RUNG_BELOW), [], true, [537, 840]],
  ["rung-above", (m) => velocityForHeading(m, RUNG_ABOVE), [], true, [537, 840]],
  ["bottom-rung", (m) => velocityForHeading(m, LADDER[0]), [], true, [537, 840]],
  ["middle-rung", (m) => velocityForHeading(m, LADDER[2]), [], true, [537, 840]],
  ["off-by-one-entry", (m) => velocityForHeading(m, OFF_BY_ONE_ENTRY), [127, 191], true, [534, 832]],
  ["misaligned-by-a-byte", (m) => velocityForHeading(m, MISALIGNED), [], true, [537, 840]],
  ["quarter-forward", brokenQuarterForward, [0, 127, 128, 255], true, [421, 711]],
  ["unwrapped", brokenUnwrapped, everyHeading.slice(QUARTER), false, [27, 225]],
  ["pair-swapped", brokenPairSwapped, [], true, [537, 840]],
  ["second-component-dropped", brokenSecondDropped, [15, 112], true, [537, 837]],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: velocityForHeadingAtSecondFastestSpeed == oracle on RAM and the live-out at the real dispatch", { skip }, () => {
  const r = gate(velocityForHeadingAtSecondFastestSpeed);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${JSON.stringify(r.ram)}`);
  const d = unitDiff(velocityForHeadingAtSecondFastestSpeed, entryState());
  assert.equal(d, null, `the live-out diverged — ${d}`);
  const e = entryState();
  console.log(
    `  CONTRACT: entry heading ${headingOf(e)} at ${hex4(e.regs.ix)} holding ${hex4(e.regs.hl)} ` +
      `within ${ENTRY_FRAMES} frames; RAM and the pair identical`,
  );
});

test("BLIND: RAM alone passes a no-op, so RAM alone is not the gate", { skip }, () => {
  const r = unitEquivalence(turningMachine, TARGET, oracle, brokenNoOp, { maxFrames: ENTRY_FRAMES });
  assert.equal(
    r.ram,
    null,
    "the no-op DIVERGED on RAM — this routine writes memory after all, and every arm that " +
      "leans on the live-out instead of RAM must be re-derived",
  );
  assert.notEqual(
    unitDiff(brokenNoOp, entryState()),
    null,
    "the live-out passed a candidate that does nothing, so NEITHER half of the contract is a " +
      "gate here and this file proves nothing at all",
  );
  console.log("  BLIND: a no-op is RAM-identical and live-out-different — the pair is the gate");
});

test("TAPE REACH: ZERO without the poke, and the game's own selector with it", { skip }, () => {
  const counts = [];
  for (const [label, opts] of [
    ["shared", {}],
    ["attract", { tape: [] }],
    ["turning", { tape: turnTape() }],
    ["weaving", { tape: weaveTape() }],
  ]) {
    let dispatches = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => { dispatches++; return oracle(mm); }]]), opts);
    const ran = m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} tape stopped early: ${m.stoppedBy}`);
    assert.equal(ran.length, CORPUS_FRAMES, `the ${label} tape ran short`);
    assert.equal(dispatches, 0, `the ${label} tape now reaches this entry unpoked — the corpus ` +
      "should be rebuilt on natural play rather than on the poke");
    counts.push(`${label} ${dispatches}`);
  }
  for (const s of sessions()) {
    assert.ok(s.dispatches > 0, "the poked twin of a tape must reach it, or the A/B has no " +
      "positive arm and the era is not what selects this entry");
    counts.push(`${s.label}+poke ${s.dispatches}`);
  }
  console.log(`  TAPE REACH: ${counts.join(", ")} dispatches in ${CORPUS_FRAMES} frames`);
});

test("DEAD FIRST DISPATCH: doubling the budget captures the SAME entry", { skip }, () => {
  const first = entryState();
  let later = null;
  unitEquivalence(turningMachine, TARGET, oracle, (m) => {
    if (later === null) later = m.clone();
    return velocityForHeadingAtSecondFastestSpeed(m);
  }, { maxFrames: 2 * ENTRY_FRAMES });
  assert.notEqual(later, null, "vacuous: the doubled budget never reached the routine");
  assert.equal(headingOf(later), headingOf(first), "a longer run must not change the entry");
  assert.equal(later.regs.ix, first.regs.ix, "nor which record it came from");
  console.log(
    `  DEAD FIRST DISPATCH: heading ${headingOf(first)} at ${hex4(first.regs.ix)} on both ` +
      "budgets — only crafting escapes it",
  );
});

test("DEGENERATE ENTRY: the second component is zero and one twin hides there", { skip }, () => {
  const e = entryState();
  const first = sampleAt(e, VELOCITY_TABLE, headingOf(e));
  const second = sampleAt(e, VELOCITY_TABLE, headingOf(e) - QUARTER);
  assert.equal(second, 0, "the entry's second component is expected to be zero");
  assert.notEqual(first, 0, "the first component is not, which is what keeps the arm above alive");
  const blind = TWINS.filter(([, twin]) => unitDiff(twin, e) === null).map(([label]) => label);
  assert.deepEqual(blind, ["unwrapped"], "the set of twins the first dispatch cannot see moved");
  console.log(
    `  DEGENERATE: heading ${headingOf(e)} gives components ${first}/${second}; the ` +
      `${blind.join(", ")} twin is invisible here, which is why the sweep is load-bearing`,
  );
});

test("UNIFORM CORPUS: the corpus varies the heading and nothing else", { skip }, () => {
  const seen = sessions();
  assert.equal(seen.length, SESSIONS.length, "vacuous: a session is missing from the corpus");
  for (const s of seen) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reached the routine`);
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.headings.size, DISTINCT_HEADINGS[s.label], `the ${s.label} heading count moved`);
  }
  const [turning, weaving] = seen;
  const added = [...weaving.headings].filter((h) => !turning.headings.has(h));
  assert.equal(added.length, WEAVING_ADDS, "the number of headings the second tape adds moved; " +
    "at zero it would be a duplicate corpus wearing a second name");
  const neither = everyHeading.filter((h) => !turning.headings.has(h) && !weaving.headings.has(h));
  assert.equal(neither.length, NEVER_DRIVEN, "the size of the band no tape drives moved");

  // The two stated holes, asserted so they cannot silently close or silently widen.
  const pointers = new Set(seen.flatMap((s) => [...s.pointers]));
  const bases = new Set(seen.flatMap((s) => [...s.bases]));
  assert.equal(pointers.size, 1, "the number of distinct incoming pointers moved");
  assert.equal(bases.size, 1, "the number of record bases real play presents moved");
  for (const table of LADDER) {
    assert.ok(!pointers.has(table), `a caller now arrives holding ${hex4(table)}, so forwarding it hides`);
  }
  console.log(
    `  UNIFORM CORPUS: ${seen.map((s) => `${s.label} ${s.dispatches}/${s.headings.size}`).join(", ")} ` +
      `(dispatches/headings); the second tape adds ${added.length}; ${neither.length} headings ` +
      `no tape reaches; incoming pointer ${[...pointers].map(hex4).join(",")}; ${bases.size} record base`,
  );
});

test("CORPUS: every dispatch of both driven sessions replays identically", { skip }, () => {
  const seen = sessions();
  let total = 0;
  for (const s of seen) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} session never reached the routine`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches over two sessions, RAM and the pair identical`);
});

test("EXCLUDED, deliberately: only the dropped registers move, over the whole sweep", { skip }, () => {
  const moved = new Set();
  for (const heading of everyHeading) {
    const a = selector(heading);
    const b = a.clone();
    oracle(a);
    velocityForHeadingAtSecondFastestSpeed(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  }
  assert.deepEqual(
    REG_FIELDS.filter((k) => moved.has(k)),
    MOVED,
    "the excluded set changed shape: only the accumulator, the flag byte, the address pair " +
      "and the stack pointer may differ",
  );
  for (const k of LIVE_OUT) assert.ok(!moved.has(k), `the live-out ${k} moved somewhere`);
  console.log(`  EXCLUDED: ${[...moved].join(", ")} and pc — the pair matches on all ${HEADINGS} headings`);
});

test("EXHAUSTIVE: 256 headings crafted off the real entry are identical", { skip }, () => {
  let swept = 0;
  for (const heading of everyHeading) {
    const d = unitDiff(velocityForHeadingAtSecondFastestSpeed, selector(heading));
    assert.equal(d, null, `heading ${heading}: ${d}`);
    swept++;
  }
  assert.equal(swept, HEADINGS, "the sweep did not cover the whole circle");
  console.log(`  EXHAUSTIVE: ${swept} headings identical, the band no tape drives included`);
});

test("THE INCOMING POINTER IS IGNORED: forcing it hostile leaves no trace", { skip }, () => {
  const r = hostileSession((mm) => {
    mm.regs.hl = RUNG_BELOW;
    return oracle(mm);
  });
  assert.equal(r.stopped, null, `a run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.dispatches > 0, "vacuous: the instrument never reached the routine");
  assert.equal(r.cells, 0, "the pointer a caller holds reached game memory, so this entry does " +
    "NOT override it and the whole reading of the file is wrong");
  console.log(
    `  IGNORED: a neighbouring table forced in before all ${r.dispatches} dispatches over ` +
      `${r.frames} frames, no trace`,
  );
});

test("LIVE-OUT: the dropped registers are dead and the declared pair is NOT", { skip }, () => {
  const dead = hostileSession((mm) => {
    const v = oracle(mm);
    for (const k of DROPPED) mm.regs[k] = 0x5a;
    return v;
  });
  assert.equal(dead.stopped, null, `a run stopped early (${dead.stopped})`);
  assert.equal(dead.frames, CORPUS_FRAMES, `compared ${dead.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(dead.dispatches > 0, "vacuous: the instrument never reached the routine");
  assert.equal(dead.cells, 0, "a hostile value in a register the rewrite does not promise reached " +
    "game memory: some caller CONSUMES it and the live-out claim is wrong");

  // The tooth on that instrument: the registers the rewrite DOES promise are consumed downstream,
  // so forcing either half of the pair forks the run. Without this the arm above proves nothing.
  const forks = [];
  for (const pair of ["de", "bc"]) {
    const r = hostileSession((mm) => {
      const v = oracle(mm);
      mm.regs[pair] = 0x5a5a;
      return v;
    });
    assert.ok(r.cells > 0, `forcing ${pair} hostile left the machine identical, so the instrument ` +
      "cannot see this routine's output at all and the arm above is vacuous");
    forks.push(`${pair} ${r.cells}`);
  }
  console.log(
    `  LIVE-OUT: ${DROPPED.join(", ")} forced hostile after all ${dead.dispatches} dispatches, ` +
      `no trace; the declared pair forks the run (${forks.join(", ")} cells)`,
  );
});

test("RUNG LADDER: no heading makes a neighbouring rung indistinguishable", { skip }, () => {
  const m = entryState();
  const peaks = LADDER.map((t) => Math.max(...everyHeading.map((h) => Math.abs(signedAt(m, t, h)))));
  assert.deepEqual(peaks, PEAKS, "the ladder of peak magnitudes moved");
  const steps = peaks.slice(1).map((p, i) => p - peaks[i]);
  assert.deepEqual(steps, [25, 25, 25, 25, 25], "the rungs stopped being evenly spaced");
  for (const neighbour of [RUNG_BELOW, RUNG_ABOVE]) {
    const oneAgrees = everyHeading.filter(
      (h) => sampleAt(m, VELOCITY_TABLE, h) === sampleAt(m, neighbour, h),
    );
    assert.deepEqual(oneAgrees, ZERO_CROSSINGS, `${hex4(neighbour)}: the agreeing headings moved`);
    const bothAgree = oneAgrees.filter(
      (h) => sampleAt(m, VELOCITY_TABLE, h - QUARTER) === sampleAt(m, neighbour, h - QUARTER),
    );
    assert.deepEqual(
      bothAgree,
      [],
      `${hex4(neighbour)} matches this entry's table on BOTH samples somewhere, so those ` +
        "headings cannot discriminate the rung and the twin's survivor list must record them",
    );
  }
  console.log(
    `  RUNG LADDER: peaks ${peaks.join("/")}; a neighbour matches one sample on ` +
      `${ZERO_CROSSINGS.length} headings and the pair on none`,
  );
});

test("EXHAUSTIVE: the shim charges exactly what the oracle charges", { skip }, () => {
  for (const heading of everyHeading) {
    const m = selector(heading);
    const predicted = oracleTStates(m);
    const before = m.cycles;
    oracle(m);
    assert.equal(m.cycles - before, predicted, `heading ${heading}: the shim total is wrong`);
  }
  console.log("  EXHAUSTIVE: the shim's T-state total matches the oracle on every heading");
});

test("WHOLE-MACHINE: driven play is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(velocityForHeadingAtSecondFastestSpeed);
  const fired = w.invocations.get(TARGET);
  assert.ok(fired > 0, "vacuous: the override never dispatched in this many frames");
  assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${fired} dispatches, RAM identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, survives, caughtAtDispatch, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on EXACTLY the declared headings`, { skip }, () => {
    const caught = [];
    const missed = [];
    for (const h of everyHeading) {
      (unitDiff(twin, selector(h)) === null ? missed : caught).push(h);
    }
    assert.deepEqual(missed, survives, `${label}: wrong survivor set over the heading sweep`);
    assert.deepEqual(
      [...caught, ...missed].sort((x, y) => x - y),
      everyHeading,
      "caught and missed must PARTITION the headings, sharing none and omitting none",
    );
    console.log(`  TEETH/${label}: caught on ${caught.length} of ${HEADINGS} headings`);
  });

  test(`TEETH: the ${label} twin at the real dispatch, hole pinned`, { skip }, () => {
    const d = unitDiff(twin, entryState());
    assert.equal(
      d !== null,
      caughtAtDispatch,
      `the real dispatch's blindness to the ${label} twin changed — re-derive the holes`,
    );
    console.log(`  TEETH/${label}: real dispatch ${d ? `caught — ${d}` : "BLIND, as recorded"}`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    for (const [i, r] of counts.entries()) {
      assert.ok(r.dispatches > 0, `vacuous: the ${SESSIONS[i][0]} session never dispatched`);
      assert.equal(r.dispatches, DISPATCHES[SESSIONS[i][0]], "the session's dispatch count moved");
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} catch count moved`);
    }
    assert.ok(
      counts.some((r) => r.caught > 0),
      `every real session PASSED the ${label} twin — only crafted entries catch it`,
    );
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
  });

  test(`TEETH: the ${label} twin FORKS the whole machine`, { skip }, () => {
    const w = replay(twin);
    assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the twin never dispatched");
    assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
    assert.equal(w.equal, false, `the ${label} twin ran clean — the replay has no teeth`);
    console.log(`  TEETH/${label}: forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  });
}
