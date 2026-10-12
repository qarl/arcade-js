// SPDX-License-Identifier: GPL-3.0-only
/**
 * hasReachedNativeXEdgeWindow — memory-equivalent to the frozen oracle at ROM 0x3CE1.
 *
 * ★ NO DRIVEN TAPE REACHES THIS ENTRY AT ALL. The shared tape presses only coin 1 and 1 player
 *   start; IT NEVER FIRES AND NEVER STEERS. A second tape that holds the trigger down and walks
 *   the stick round the compass does not reach it either — both dispatch it ZERO times in 2600
 *   frames. Only the UNDRIVEN ATTRACT DEMO reaches it, and not before frame 1378. Every corpus
 *   arm below therefore runs the attract tape, and test 3 asserts the two driven zeroes and that
 *   first frame, so this is a measured fact rather than a note that could rot.
 *
 * ★ AND THE REAL CORPUS IS DEGENERATE IN THE ONE WAY THAT MATTERS: the answer is FALSE at every
 *   single dispatch, and the carry the caller arrives with is already clear. So a candidate that
 *   answers nothing is INDISTINGUISHABLE from the real routine on real data — the whole-machine
 *   replay passes a no-op, and the twin arms assert that verdict rather than leaving it to be
 *   discovered. The teeth are in the crafted sweep, exhaustive because the routine reads ONE cell.
 *
 * RAM IS NOT THE GATE HERE, and test 1 proves it rather than assuming it: the routine writes no
 * memory, so a RAM comparison returns identical for the real routine, for every twin and for a
 * bare no-op. The live-out is the oracle's CARRY FLAG, which the rewrite RETURNS, and every unit arm
 * compares the return against it. `r.equal` is never asserted — it folds in the register diff this
 * contract drops.
 *
 * GATE: strict unit-capture, the attract corpus replayed at every dispatch, an exhaustive sweep of
 *   the routine's entire input space at five sprite-entry bases, a whole-session hostile-register
 *   instrument, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. BLIND — a no-op passes the RAM diff, so RAM cannot be this gate.
 *   2. EQUAL at the real dispatch — the returned boolean against the carry, with the registers allowed to
 *      differ bounded by {a, f, sp}: a register outside that set diverging fails the arm, and a
 *      rewrite that diverges on fewer of them passes. The stack pointer is in that set because the
 *      layer models no stack: the frozen routine takes the return its caller pushed and the
 *      rewrite does not.
 *   3. NO DRIVEN TAPE REACHES IT — the two zeroes above, asserted.
 *   4. DEGENERATE ENTRY AND DEGENERATE CORPUS — the captured entry answers false, and so does
 *      every other dispatch; one sprite-entry base and one era occur. Doubling the entry budget
 *      captures the SAME entry, so no frame budget escapes it, only crafting does.
 *   5. CORPUS — every dispatch of the attract session, compared on the returned boolean.
 *   6. EXHAUSTIVE — the routine reads exactly one cell, so 256 values IS its whole input space and
 *      every value is swept. The set answering true is asserted to be exactly four values.
 *   7. CRAFTED BASES — the same sweep at four further sprite-entry bases, because real play presents
 *      one.
 *   8. HONEST SIGNATURE — passing the sprite-entry base explicitly agrees with taking it from the
 *      register the frozen routine reads it from.
 *   9. LIVE-OUT IS CARRY ONLY — measured, not argued: a whole attract session with the accumulator
 *      and every non-carry flag forced hostile after each dispatch is bit-identical to the clean
 *      run, and the tooth beside it shows the instrument is wired, because flipping the carry
 *      instead forks the run.
 *   9a. HAND-OFF — the carry is read back, so the rewrite leaves it out of the registers only
 *      because every reader is an override that takes the return: measured on the ORACLE over the
 *      tape sessions, the callers that hear F complemented at this exit are exactly CARRY_READERS
 *      (each the return address after a `call 0x3CC4`, which tail-transfers here), each owned by a
 *      ROUTINES entry, with the SP flip at the same exit heard. HOLE: a reader reached only in a
 *      state no session drives is not measured.
 *  10. WHOLE-MACHINE — the attract session byte-identical with the rewrite wired through a shim
 *      that pays the oracle's T-states, hands its return to the frozen caller in carry (as the
 *      overrides that own those callers take it) and takes its return, since every path in arrives
 *      by a tail transfer. Its BLIND SPOT is declared per twin and asserted, not summarised.
 *  11. The shim's total, checked against the oracle over the whole sweep.
 *  12. TEETH — twins, each declaring the EXACT number of input values it is caught on by the
 *      returned contract, plus its whole-machine verdict.
 *
 * HOLE: EVERY dispatch this gate has ever seen sits in ONE era of the attract demo, at ONE sprite-entry
 * base. The routine's body reads a single cell and no era cell, so its ANSWER cannot depend on the
 * era — but the states it is dispatched IN are era-limited, and nothing here speaks for the later
 * eras or for a dispatch during real play, because none was ever observed.
 * HOLE: the crafted arms vary the value read and the base it is read from; the rest of the machine
 * stays frozen at the one captured entry.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3ce1.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { TAPE_SESSIONS, handOffReaders, heardAs } from "./_deadAtExit.js";
import { hasReachedNativeXEdgeWindow } from "../hasReachedNativeXEdgeWindow.js";
import { loc_3ce1 as oracle } from "../../translated/loc_3ce1.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS, F_C } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";
import { ERA_INDEX, ROUTINES } from "../names.js";

const TARGET = 0x3ce1;

const VALUES = 256;
const WINDOW = 4;
const STARTS_BELOW_WRAP = 2;

/** The native-Y byte (+0x31) of the same sprite entry, and the byte next door, for two of the twins. */
const OTHER_COORDINATE = 49;
const NEIGHBOUR = 1;

const EXCLUDED = ["a", "f", "sp"];
const LEFT_BEHIND_FLAGS = 0xff & ~F_C;
const HOSTILE = 0x5a;

const CORPUS_FRAMES = 2600;

/** Return address of each caller that reads the carry -> the override owning that code: `call 0x3cc4`
 *  at 0x3B88 in flyBomberThenTryAimedShot (0x3B77) and at 0x4447 in
 *  dressSpriteForHeadingOrRetireAtEdge (0x4447), each followed by `jp c`. */
const CARRY_READERS = new Map([[0x3b8b, [0x3b77]], [0x444a, [0x4447]]]);
const HANDOFF_FRAMES = 2500;

/**
 * The shared harness budget is sized for entries a driven tape reaches early. This one is first
 * reached at FIRST_ATTRACT_FRAME of an UNDRIVEN run, so the budget is raised here to leave margin.
 */
const ENTRY_BUDGET = 1600;

/** T-states: three instructions and the return, with no branch, so the total is a constant. */
const TSTATES = 43;
const RET_TSTATES = 10;

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

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const everyValue = Array.from({ length: VALUES }, (_unused, v) => v);

/** The shared tape with the trigger held and the stick walked once round the compass. */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: COIN, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: START, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: FIRE, dur: CORPUS_FRAMES },
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

const ATTRACT = { tape: [] };
const attractMachine = (overrides) => makeMachine(overrides, ATTRACT);

/** Dispatches each tape produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 0, turning: 0, attract: 344 };

/** The frame the undriven demo first dispatches it on, which is what sets the entry budget. */
const FIRST_ATTRACT_FRAME = 1378;

const TAPES = [
  ["shared", {}],
  ["turning", { tape: turnTape() }],
  ["attract", ATTRACT],
];

/** The values that answer true, re-derived here from the window rather than from the routine. */
const TRUE_VALUES = everyValue.filter((v) => u8(v + STARTS_BELOW_WRAP) < WINDOW);

// ── the entry, and the two comparisons ──────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    attractMachine,
    TARGET,
    oracle,
    (m) => {
      if (entry === null) entry = m.clone();
      return candidate(m);
    },
    { maxFrames: ENTRY_BUDGET },
  );
}

function entryState() {
  if (entry === null) gate(hasReachedNativeXEdgeWindow);
  return entry;
}

/** One comparison: RAM, then the candidate's returned answer against the oracle's carry. */
function verdicts(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  const answer = candidate(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  return { contract: ram !== null || answer !== a.regs.fC, ram, expected: a.regs.fC };
}

/** A real captured machine with the read cell forced, which is the crafted-entry idiom. */
function craft(value, base = entryState().regs.iy) {
  const m = entryState().clone();
  m.regs.iy = base;
  m.mem8[base] = value;
  return m;
}

/** Bases beyond the single one real play presents; the sprite-entry stride is two. */
const CRAFT_BASES = [0xaa00, 0xaa26, 0xaa2a, 0xaa50];

/** Split the whole input space into the values a candidate is caught on and the ones it survives. */
function sweep(candidate, base) {
  const contract = [];
  for (const v of everyValue) {
    if (verdicts(candidate, craft(v, base)).contract) contract.push(v);
  }
  return { contract };
}

// ── replaying the attract session, one dispatch at a time ───────────────────────────────

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caughtContract = 0;
  let trues = 0;
  let firstFrame = null;
  const values = new Set();
  const bases = new Set();
  const eras = new Set();
  const carryIn = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (firstFrame === null) firstFrame = mm.frames.length;
      values.add(mm.mem8[mm.regs.iy]);
      bases.add(mm.regs.iy);
      eras.add(mm.mem8[ERA_INDEX]); // read only to attribute the corpus to a game state
      carryIn.add(mm.regs.fC);
      const r = verdicts(candidate, mm);
      if (r.contract) caughtContract++;
      if (r.expected) trues++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, firstFrame, caughtContract, trues, values, bases, eras, carryIn };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, hasReachedNativeXEdgeWindow) }));
  return sessionCache;
}

// ── the whole-session hostile-register instrument ───────────────────────────────────────

function hostileSession(mutate) {
  const base = attractMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let dispatches = 0;
  const host = attractMachine(new Map([[TARGET, (mm) => (dispatches++, mutate(mm))]]));
  const hostFrames = host.runFrames(CORPUS_FRAMES);
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.stateOffsetToAddr(o));
  }
  return { cells: cells.size, frames: n, dispatches, stopped: base.stoppedBy ?? host.stoppedBy };
}

// ── the cycle shim, and the whole-machine replay ────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    mm.regs.fC = candidate(mm) === true;
    mm.tick(TSTATES - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

function replay(candidate) {
  return wholeMachineEquivalence(
    attractMachine,
    CORPUS_FRAMES,
    new Map([[TARGET, hosted(candidate)]]),
  );
}

// ── the twins ───────────────────────────────────────────────────────────────────────────
// Ways to get a one-cell window test wrong: the window's width, its position, its wrap, which cell
// it reads, and answering in the flag instead of returning.

const at = (m, offset = 0) => m.mem8[u16(m.regs.iy + offset)];

/** BUG: answers nothing — the tell that a gate is measuring an unreached routine. */
const brokenNoOp = () => {};
/** BUG: everything has arrived. */
const brokenAlwaysTrue = () => true;
/** BUG: nothing ever has — indistinguishable from the real routine on all real data. */
const brokenAlwaysFalse = () => false;
/** BUG: the window is one value too wide, so an object is retired a step early. */
const brokenWider = (m) => u8(at(m) + STARTS_BELOW_WRAP) < WINDOW + 1;
/** BUG: one too narrow, so the value that arrives exactly on the far edge is missed. */
const brokenNarrower = (m) => u8(at(m) + STARTS_BELOW_WRAP) < WINDOW - 1;
/** BUG: the window sits one value late, so it starts at the wrap instead of short of it. */
const brokenShifted = (m) => u8(at(m) + STARTS_BELOW_WRAP - 1) < WINDOW;
/** BUG: an unwrapped range test, so only the half at or past the wrap counts. */
const brokenUnwrapped = (m) => at(m) < WINDOW;
/** BUG: reads the byte next door in the sprite entry. */
const brokenNeighbour = (m) => u8(at(m, NEIGHBOUR) + STARTS_BELOW_WRAP) < WINDOW;
/** BUG: measures the entry's native-Y byte instead of its native-X one. */
const brokenOtherCoordinate = (m) => u8(at(m, OTHER_COORDINATE) + STARTS_BELOW_WRAP) < WINDOW;
/** BUG: right answer left in the carry flag, nothing returned to the caller that takes the value. */
const brokenNoReturn = (m) => {
  m.regs.fC = u8(at(m) + STARTS_BELOW_WRAP) < WINDOW;
};

/**
 * Per twin: the values it is caught on by the returned contract, and whether the whole-machine
 * replay sees it. All measured, all asserted as exact counts, so a twin caught on the WRONG values
 * fails as loudly as one not caught.
 */
const TWINS = [
  ["no-op", brokenNoOp, 256, false],
  ["always-true", brokenAlwaysTrue, 252, true],
  ["always-false", brokenAlwaysFalse, 4, false],
  ["window-one-wider", brokenWider, 1, false],
  ["window-one-narrower", brokenNarrower, 1, false],
  ["window-shifted-one", brokenShifted, 2, false],
  ["unwrapped", brokenUnwrapped, 4, false],
  ["reads-the-neighbour", brokenNeighbour, 252, true],
  ["reads-the-other-coordinate", brokenOtherCoordinate, 4, true],
  ["no-return", brokenNoReturn, 256, false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("BLIND: RAM is a TAUTOLOGY here — a bare no-op passes it too", { skip }, () => {
  const r = gate(brokenNoOp);
  assert.equal(
    r.ram,
    null,
    "a no-op DIVERGED on RAM, so this routine writes memory after all and every claim in this " +
      "file has to be re-derived",
  );
  console.log("  BLIND: the RAM diff is identical for a no-op — the answer is the only gate");
});

test("EQUAL at the real dispatch: the returned boolean is the carry, excluded set bounded", { skip }, () => {
  const r = gate(hasReachedNativeXEdgeWindow);
  assert.notEqual(entry, null, "vacuous: the attract run never reached the routine");
  assert.equal(r.ram, null, "RAM diverged");

  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  const answer = hasReachedNativeXEdgeWindow(b);

  assert.equal(answer, a.regs.fC, "the returned boolean must be the oracle's carry");
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle takes its return; the rewrite does not");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(
    `  EQUAL: entry base ${hex4(entryState().regs.iy)} value ${entryState().mem8[entryState().regs.iy]} ` +
      `answers ${a.regs.fC}; only ${EXCLUDED.join(", ")} and pc differ`,
  );
});

test("NO DRIVEN TAPE REACHES IT: both driven tapes dispatch it zero times", { skip }, () => {
  const seen = sessions();
  const attract = seen.find((s) => s.label === "attract");
  for (const s of seen) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
  }
  assert.equal(seen.find((s) => s.label === "shared").dispatches, 0, "the shared tape now reaches it");
  assert.equal(seen.find((s) => s.label === "turning").dispatches, 0, "the turning tape now reaches it");
  assert.ok(attract.dispatches > 0, "vacuous: the attract tape stopped reaching it too");
  assert.equal(attract.firstFrame, FIRST_ATTRACT_FRAME, "the first attract dispatch moved");
  console.log(
    `  NO DRIVEN TAPE: shared 0, turning 0, attract ${attract.dispatches} over ${CORPUS_FRAMES} ` +
      `frames, the first at ${attract.firstFrame} — the corpus is the undriven demo and nothing else`,
  );
});

test("DEGENERATE CORPUS: every real answer is false, at one base, in one era", { skip }, () => {
  const s = sessions().find((x) => x.label === "attract");
  assert.equal(s.trues, 0, "a real dispatch answered true, so the corpus is no longer degenerate " +
    "and the blindness this file records must be re-derived");
  assert.deepEqual([...s.carryIn], [false], "a caller now arrives with carry already set");
  assert.equal(s.bases.size, 1, "real play now presents more than one sprite-entry base");
  assert.equal(s.eras.size, 1, "the corpus now spans more than one era");
  const values = [...s.values].sort((a, b) => a - b);
  assert.ok(!values.some((v) => TRUE_VALUES.includes(v)), "a value inside the window now occurs");
  console.log(
    `  DEGENERATE CORPUS: ${s.dispatches} dispatches, 0 answering true; ${values.length} distinct ` +
      `values in ${values[0]}..${values[values.length - 1]}; base ${[...s.bases].map(hex4)}; era ` +
      `${[...s.eras]}`,
  );
});

test("DEGENERATE ENTRY: doubling the budget captures the SAME entry", { skip }, () => {
  const first = entryState();
  let later = null;
  unitEquivalence(attractMachine, TARGET, oracle, (m) => {
    if (later === null) later = m.clone();
    return hasReachedNativeXEdgeWindow(m);
  }, { maxFrames: 2 * ENTRY_BUDGET });
  assert.notEqual(later, null, "vacuous: the doubled budget never reached the routine");
  assert.equal(later.regs.iy, first.regs.iy, "a longer run must not change which entry it came from");
  assert.equal(later.mem8[later.regs.iy], first.mem8[first.regs.iy], "nor the value it read");
  console.log(
    `  DEGENERATE ENTRY: value ${first.mem8[first.regs.iy]} at ${hex4(first.regs.iy)} on both ` +
      "budgets — only crafting escapes it",
  );
});

test("CORPUS: every real dispatch returns the oracle's carry", { skip }, () => {
  const s = sessions().find((x) => x.label === "attract");
  assert.ok(s.dispatches > 0, "vacuous: the session never reached the routine");
  assert.equal(s.caughtContract, 0, `the rewrite's return diverged on ${s.caughtContract}`);
  console.log(`  CORPUS: ${s.dispatches} real dispatches, the returned boolean identical on each`);
});

test("EXHAUSTIVE: all 256 values of the one cell it reads answer as the oracle does", { skip }, () => {
  const r = sweep(hasReachedNativeXEdgeWindow, entryState().regs.iy);
  assert.deepEqual(r.contract, [], `the rewrite diverged on values ${r.contract.join(",")}`);
  const trues = everyValue.filter((v) => {
    const m = craft(v);
    oracle(m);
    return m.regs.fC;
  });
  assert.deepEqual(trues, TRUE_VALUES, "the set of values inside the window moved");
  assert.equal(trues.length, WINDOW, "the window is four values wide");
  console.log(`  EXHAUSTIVE: ${VALUES} values identical; ${trues.join(",")} answer true`);
});

test("CRAFTED BASES: the same sweep at four further sprite-entry bases", { skip }, () => {
  for (const base of CRAFT_BASES) {
    const r = sweep(hasReachedNativeXEdgeWindow, base);
    assert.deepEqual(r.contract, [], `base ${hex4(base)} diverged on ${r.contract.join(",")}`);
  }
  console.log(`  CRAFTED BASES: ${CRAFT_BASES.length * VALUES} further comparisons identical`);
});

test("HONEST SIGNATURE: the explicit base agrees with the register default", { skip }, () => {
  for (const value of [0, 1, 2, 49, 253, 254, 255]) {
    const viaRegister = craft(value);
    const viaArgument = craft(value);
    const a = hasReachedNativeXEdgeWindow(viaRegister);
    const b = hasReachedNativeXEdgeWindow(viaArgument, viaArgument.regs.iy);
    assert.equal(a, b, `value ${value}: the two entry forms disagree`);
  }
  console.log("  HONEST SIGNATURE: the named parameter and the register default agree");
});

test("EXHAUSTIVE: the shim charges exactly what the oracle charges", { skip }, () => {
  for (const value of everyValue) {
    const m = craft(value);
    const before = m.cycles;
    oracle(m);
    assert.equal(m.cycles - before, TSTATES, `value ${value}: the shim total is wrong`);
  }
  console.log(`  EXHAUSTIVE: the oracle charges ${TSTATES} on every value, as the shim assumes`);
});

test("LIVE-OUT IS CARRY ONLY: the accumulator and the other flags steer nothing", { skip }, () => {
  const r = hostileSession((mm) => {
    const v = oracle(mm);
    mm.regs.a = HOSTILE;
    mm.regs.f = (mm.regs.f & F_C) | LEFT_BEHIND_FLAGS;
    return v;
  });
  assert.equal(r.stopped, null, `a run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.dispatches > 0, "vacuous: the instrument never reached the routine");
  assert.equal(r.cells, 0, "a hostile value in something this rewrite does not promise reached " +
    "game memory: some caller CONSUMES it and the live-out claim is wrong");
  console.log(
    `  LIVE-OUT: hostile accumulator and non-carry flags on all ${r.dispatches} dispatches over ` +
      `${r.frames} frames, no trace`,
  );
});

test("TEETH: the hostile instrument is WIRED — flipping the carry forks the run", { skip }, () => {
  const r = hostileSession((mm) => {
    const v = oracle(mm);
    mm.regs.f ^= F_C;
    return v;
  });
  assert.ok(r.cells > 0, "flipping the one flag this routine exists to set left the machine " +
    "identical, so the arm above never reaches the routine and proves nothing");
  console.log(`  TEETH/instrument: flipping the carry forks ${r.cells} cells`);
});

test("HAND-OFF: every caller that reads the carry is an override that takes the return", { skip }, () => {
  const { callers, readers, exitControl } = handOffReaders({
    at: TARGET, poison: ["f"], sessions: TAPE_SESSIONS, frames: HANDOFF_FRAMES,
  });
  assert.ok(callers.size > 0, "vacuous: no session dispatched the window test");
  assert.deepEqual([...readers.keys()].sort((p, q) => p - q), [...CARRY_READERS.keys()],
    "the set of callers that read the oracle's carry moved -- a new reader needs its override checked");
  for (const [ret, owners] of CARRY_READERS) {
    const served = owners.filter((addr) => ROUTINES[addr] !== undefined);
    assert.deepEqual(served, owners, `the reader after ${hex4(ret)} is not served by an override`);
  }
  console.log(`  HAND-OFF: ${callers.size} callers, F heard at ` +
    `${[...readers].map(([r, w]) => `${hex4(r)} (${w})`).join(" ")}, each served by an override; ` +
    `exit control heard (${heardAs(exitControl)})`);
});

test("WHOLE-MACHINE: the attract session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(hasReachedNativeXEdgeWindow);
  const fired = w.invocations.get(TARGET);
  assert.equal(fired, DISPATCHES.attract, "the replay's dispatch count moved");
  assert.equal(w.framesCompared, CORPUS_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${fired} dispatches, RAM identical`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, byContract, wholeMachineSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on EXACTLY the declared values`, { skip }, () => {
    const r = sweep(twin, entryState().regs.iy);
    assert.equal(r.contract.length, byContract, `${label}: the contract catch count moved`);
    assert.ok(r.contract.length > 0, `the sweep PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught on ${byContract} of ${VALUES}`);
  });

  test(`TEETH: the whole-machine replay sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const w = replay(twin);
    assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the twin never dispatched");
    assert.equal(
      w.equal,
      !wholeMachineSees,
      `the whole-machine verdict on the ${label} twin changed — re-derive the holes`,
    );
    console.log(
      `  TEETH/${label}: whole-machine ${wholeMachineSees ? `forks at frame ${w.frame}` : "is BLIND, as recorded"}`,
    );
  });
}

test("TEETH: the crafted sweep is STRICTLY stronger than everything the machine can see", { skip }, () => {
  const blind = TWINS.filter(([, , , seen]) => !seen).map(([label]) => label);
  for (const label of blind) {
    const twin = TWINS.find(([l]) => l === label)[1];
    assert.ok(
      sweep(twin, entryState().regs.iy).contract.length > 0,
      `${label} escapes BOTH the running machine and the crafted sweep`,
    );
  }
  assert.ok(
    blind.includes("no-op"),
    "the running machine has started catching a no-op, so this file's central warning — that " +
      "the real corpus cannot tell this routine from one that answers nothing — is now false",
  );
  console.log(`  TEETH: whole-machine-blind but crafted-caught — ${blind.join(", ")}`);
});
