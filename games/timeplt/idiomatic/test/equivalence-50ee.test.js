// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroyPlayerAndMotherShipOnContact — memory-equivalent to the frozen oracle at ROM 0x50EE.
 *
 * WHAT IT IS. A four-test guard and, when all four hold, four effects: two state bytes take a
 * destroyed code, a third cell beside them is cleared, and the chained hit score is posted. The
 * score routine is ALREADY decompiled, so the rewrite calls it directly and dissolving that
 * transfer belongs to this entry's unit. The oracle reaches it by a tail jump and takes its
 * return, which is why the whole-machine arms below wire the rewrite through the omitted-return
 * seam and one of them removes it on purpose.
 *
 * ★ NO TAPE DISPATCHES THIS ENTRY. The one site that transfers here does so only on the first and
 *   the last of the game's five eras, and every tape spends its whole budget on the second. So the
 *   corpus is MADE: the era cell is forced to the first for the duration of the caller's own
 *   dispatch and restored immediately after, identically on both sides of every comparison. The
 *   caller then transfers here for real, hundreds of times, on a real machine with real objects.
 *
 * GATE: nudged real dispatches, a crafted sweep of the whole decision space, and a whole-machine
 *   replay on three tapes. What it exercises, holes stated:
 *
 *   1. NEVER DISPATCHED — three tapes, zero dispatches each, asserted.
 *   2. NUDGED CORPUS — the counts per tape, every dispatch replayed, AND the guard outcomes
 *      counted: how many arrive with the first thing live, with both live, and with the first
 *      axis inside. The fourth test never once passes, so THE DESTROY PATH NEVER RUNS ON REAL
 *      DATA and the arm asserts that zero rather than letting the corpus read as coverage.
 *   3. EQUAL at a nudged dispatch, outside the dead stack window.
 *   4. NOT VACUOUS — a candidate that does nothing FAILS the crafted comparison. It does NOT fail
 *      on a nudged dispatch, which is arm 2's finding restated as a test.
 *   5. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      space, BOUNDED by a measured set rather than pinned to it: a register diverging outside
 *      that set fails the arm, and a rewrite that diverges on fewer still passes. The sprite-entry
 *      base register is in it: the oracle loads it and the rewrite does not, and the whole-machine
 *      arms are what show nothing downstream reads it.
 *   6. THE MASK IS LOAD-BEARING, MEASURED — the crafted entries where an unmasked comparison
 *      differs are counted, and the window they differ in is pinned to exactly six bytes below the
 *      entry stack pointer. Both numbers are asserted, so the window cannot quietly widen.
 *   7. EXHAUSTIVE — four live/dead combinations against each axis swept over all 256 coordinates
 *      from two bases, one of which makes the difference wrap. The count of crafted entries the
 *      ORACLE destroys on is asserted too, so an arm that stopped reaching the destroy path would
 *      fail rather than pass empty.
 *   8. WHOLE-MACHINE — three sessions, the rewrite wired through the omitted-return seam.
 *   9. TEETH/seam — the same wiring with the seam removed, which must die.
 *  10. TEETH — nine twins, each with an exact crafted count, an exact nudged count, and a recorded
 *      whole-machine verdict.
 *
 * HOLE: THE WHOLE-MACHINE ARM IS NEARLY BLIND HERE, and that is measured rather than argued.
 * Because no real dispatch passes all four tests, a session with the rewrite wired is identical to
 * an all-oracle one for every twin except the one that ignores the second thing's state — which
 * starts destroying things that are not there. Eight of the nine twins are recorded blind to it.
 * The crafted sweep is the load-bearing arm for everything this entry WRITES.
 * HOLE: the corpus exists only because the era cell was forced. Nothing here shows what the game
 * looks like on the eras that reach this entry naturally, only that the entry behaves identically
 * on the states the second era produces.
 * HOLE: the two coordinate bases in the sweep are chosen, not observed; the nudged corpus presents
 * a narrow range of real ones and the arm reports how many of them clear the first axis.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-50ee.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { ROUTINES as ORACLE_ROUTINES } from "../../routines.js";
import { withOmittedRet } from "../../machine.js";
import { destroyPlayerAndMotherShipOnContact } from "../destroyPlayerAndMotherShipOnContact.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { loc_50ee as oracle } from "../../translated/loc_50ee.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { ERA_INDEX, PLAYER_STATE, MOTHER_SHIP_STATE } from "../names.js";
import { u8, u16 } from "../../../../core/int.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x50ee;
/** The only site that transfers here, and the only place a real entry can be taken from. */
const CALLER = 0x50b1;
/** The era this entry serves; the caller reaches it on this one and on the last. */
const NUDGED_ERA = 0;

const ENTRY = 0xaa10;
const ENTRY_SECOND_AXIS = 49;
const CLEARED_BESIDE = 0xa8a4;
const SECOND_FIRST_AXIS = 0xaa24;
const SECOND_SECOND_AXIS = 0xaa55;

const LIVE = 255;
const DESTROYED = 240;
const FIRST_AXIS_REACH = 8;
const FIRST_AXIS_SPAN = 17;
const SECOND_AXIS_REACH = 25;
const SECOND_AXIS_SPAN = 35;

/** The score routine brackets its work, and its own helper pushes too. Measured, then pinned. */
const SCRATCH_BYTES = 6;
const SCRATCH_OFFSETS = [-6, -5, -4, -3, -2, -1];
/**
 * The registers allowed to diverge: the accumulator and flags carry each of the four tests, the
 * sprite-entry base is loaded into IX and the rewrite does not load it, and the omitted return
 * lifts SP. A BOUND, not an exact list: a register diverging outside this set fails the arm below,
 * and a rewrite that diverges on fewer of them still passes. It is a UNION over the crafted space,
 * so every member is known to have moved SOMEWHERE in it, not at every entry. BC, DE, HL, IY and
 * the whole shadow bank are deliberately absent, so none of them can be excused here.
 */
const EXCLUDED = ["a", "f", "ix", "sp"];

const CORPUS_FRAMES = 6000;
/** Nudged dispatches per tape. Measured; a move here is a finding. */
const NUDGED = { shared: 8, attract: 325, turning: 20 };
/** Of those, how many arrive with the first thing live, with both live, and past the first axis. */
const FIRST_LIVE = { shared: 8, attract: 325, turning: 20 };
const BOTH_LIVE = { shared: 0, attract: 162, turning: 0 };
const PAST_FIRST_AXIS = { shared: 0, attract: 8, turning: 0 };
/** The dead bytes the omitted-return seam leaves differing over a whole session. Measured. */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const turnTape = () => [
  { frame: 401, port: IN0, bits: 0x01, dur: HOLD },
  { frame: 501, port: IN0, bits: 0x08, dur: HOLD },
  { frame: 601, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  { frame: 700, port: IN1, bits: 0x05, dur: CORPUS_FRAMES },
];

const TAPES = [
  ["shared", {}],
  ["attract", { tape: [] }],
  ["turning", { tape: turnTape() }],
];
/** The tape with a corpus worth replaying a twin against; the other two are counted, not swept. */
const RICHEST = 1;

const within = (a, b, reach, span) => u8(u8(a - b) + reach) < span;

// ── the masked comparison ───────────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

const inScratch = (addr, sp) => addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

/** Force the era this entry serves for the length of the caller's dispatch, then put it back. */
const nudgeEra = () => {
  const original = ORACLE_ROUTINES.get(CALLER);
  return (mm) => {
    const held = mm.mem8[ERA_INDEX];
    mm.mem8[ERA_INDEX] = NUDGED_ERA;
    const r = original(mm);
    mm.mem8[ERA_INDEX] = held;
    return r;
  };
};

function nudgedSession(candidate, opts) {
  let dispatches = 0;
  let caught = 0;
  let firstLive = 0;
  let bothLive = 0;
  let pastFirstAxis = 0;
  let destroyed = 0;
  let first = null;
  const m = makeMachine(
    new Map([
      [CALLER, nudgeEra()],
      [TARGET, (mm) => {
        dispatches++;
        if (first === null) first = mm.clone();
        const one = mm.mem8[PLAYER_STATE] === LIVE;
        const two = one && mm.mem8[MOTHER_SHIP_STATE] === LIVE;
        const near = two && within(
          mm.mem8[SECOND_FIRST_AXIS], mm.mem8[ENTRY], FIRST_AXIS_REACH, FIRST_AXIS_SPAN,
        );
        const hit = near && within(
          mm.mem8[SECOND_SECOND_AXIS], mm.mem8[u16(ENTRY + ENTRY_SECOND_AXIS)],
          SECOND_AXIS_REACH, SECOND_AXIS_SPAN,
        );
        if (one) firstLive++;
        if (two) bothLive++;
        if (near) pastFirstAxis++;
        if (hit) destroyed++;
        if (unitDiff(candidate, mm)) caught++;
        return oracle(mm);
      }],
    ]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, firstLive, bothLive, pastFirstAxis, destroyed, first };
}

let cache = null;
const sessions = () =>
  (cache ??= TAPES.map(([label, opts]) => ({ label, ...nudgedSession(destroyPlayerAndMotherShipOnContact, opts) })));

function entryState() {
  const s = sessions()[RICHEST];
  assert.notEqual(s.first, null, "vacuous: nudging the era did not reach the entry");
  return s.first;
}

// ── the crafted space ───────────────────────────────────────────────────────────────────

const STATE_PAIRS = [[LIVE, LIVE], [LIVE, 0], [0, LIVE], [0, 0]];
/** One base leaves the difference alone; the other makes it wrap through zero. */
const BASES = [0x00, 0xf8];
const COORDS = Array.from({ length: 256 }, (_unused, c) => c);
/** A coordinate pair this close is inside both windows, so the swept axis is the only variable. */
const INSIDE = 100;

function craft(firstState, secondState, firstBase, firstCoord, secondBase, secondCoord) {
  const m = entryState().clone();
  m.mem8[PLAYER_STATE] = firstState;
  m.mem8[MOTHER_SHIP_STATE] = secondState;
  m.mem8[ENTRY] = firstBase;
  m.mem8[SECOND_FIRST_AXIS] = firstCoord;
  m.mem8[u16(ENTRY + ENTRY_SECOND_AXIS)] = secondBase;
  m.mem8[SECOND_SECOND_AXIS] = secondCoord;
  return m;
}

function overSweep(fn) {
  for (const [one, two] of STATE_PAIRS) {
    for (const base of BASES) {
      for (const c of COORDS) fn(craft(one, two, base, c, INSIDE, INSIDE));
    }
    for (const base of BASES) {
      for (const c of COORDS) fn(craft(one, two, INSIDE, INSIDE, base, c));
    }
  }
}

const SWEEP_SIZE = STATE_PAIRS.length * BASES.length * COORDS.length * 2;
/** Crafted entries on which the ORACLE takes the destroy path. Measured. */
const CRAFTED_DESTROYS = 104;

function sweepCaught(candidate) {
  let caught = 0;
  overSweep((machine) => {
    if (unitDiff(candidate, machine)) caught++;
  });
  return caught;
}

function movedRegisters(candidate) {
  const moved = new Set();
  overSweep((machine) => {
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  });
  return REG_FIELDS.filter((k) => moved.has(k));
}

// ── the whole-machine arm ───────────────────────────────────────────────────────────────

const baselines = new Map();
function baseline(label, opts) {
  if (!baselines.has(label)) {
    const m = makeMachine(new Map([[CALLER, nudgeEra()]]), opts);
    const frames = m.runFrames(CORPUS_FRAMES);
    baselines.set(label, { frames, toAddr: (o) => m.stateOffsetToAddr(o), stopped: m.stoppedBy });
  }
  return baselines.get(label);
}

function wholeRunCells(candidate, label, opts, shim = withOmittedRet) {
  const base = baseline(label, opts);
  let fired = 0;
  const host = makeMachine(
    new Map([[CALLER, nudgeEra()], [TARGET, shim((mm) => (fired++, candidate(mm)))]]),
    opts,
  );
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.toAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.toAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return {
    cells: [...cells].sort((a, b) => a - b),
    frames: n,
    fired,
    threw,
    stopped: base.stopped ?? host.stoppedBy ?? null,
  };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────
// Nine ways to get a guard and four effects wrong: two drop a test, four move a window, and
// three keep the guard and break what happens when it holds.

function variant({ reach1, span1, reach2, span2, skipFirst, skipSecond, keepThird, noScore }) {
  return (m) => {
    const { mem8 } = m;
    if (!skipFirst && mem8[PLAYER_STATE] !== LIVE) return;
    if (!skipSecond && mem8[MOTHER_SHIP_STATE] !== LIVE) return;
    if (!within(mem8[SECOND_FIRST_AXIS], mem8[ENTRY], reach1, span1)) return;
    const other = mem8[u16(ENTRY + ENTRY_SECOND_AXIS)];
    if (!within(mem8[SECOND_SECOND_AXIS], other, reach2, span2)) return;
    mem8[PLAYER_STATE] = DESTROYED;
    mem8[MOTHER_SHIP_STATE] = DESTROYED;
    if (!keepThird) mem8[CLEARED_BESIDE] = 0;
    if (!noScore) postChainedHitScore(m);
  };
}

const BOX = {
  reach1: FIRST_AXIS_REACH,
  span1: FIRST_AXIS_SPAN,
  reach2: SECOND_AXIS_REACH,
  span2: SECOND_AXIS_SPAN,
};

/** BUG: does nothing at all. */
function brokenNoOp() {}

const TWINS = [
  // label, twin, crafted catches, catches on the richest tape, whole-machine verdict
  ["no-op", brokenNoOp, 104, 0, false],
  ["ignores-first-state", variant({ ...BOX, skipFirst: true }), 104, 0, false],
  ["ignores-second-state", variant({ ...BOX, skipSecond: true }), 104, 11, true],
  ["axis1-span-narrow", variant({ ...BOX, span1: FIRST_AXIS_SPAN - 1 }), 2, 0, false],
  ["axis1-off-centre", variant({ ...BOX, reach1: FIRST_AXIS_REACH - 1 }), 4, 0, false],
  ["axis2-centred", variant({ ...BOX, reach2: 17 }), 32, 0, false],
  ["axes-swapped", variant({
    reach1: SECOND_AXIS_REACH, span1: SECOND_AXIS_SPAN,
    reach2: FIRST_AXIS_REACH, span2: FIRST_AXIS_SPAN,
  }), 72, 0, false],
  ["keeps-third-cell", variant({ ...BOX, keepThird: true }), 104, 0, false],
  ["no-score", variant({ ...BOX, noScore: true }), 104, 0, false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("NEVER DISPATCHED: no tape reaches this entry, which is why the era is nudged", { skip }, () => {
  for (const [label, opts] of TAPES) {
    let hits = 0;
    const m = makeMachine(new Map([[TARGET, (mm) => (hits++, oracle(mm))]]), opts);
    m.runFrames(CORPUS_FRAMES);
    assert.equal(hits, 0, `the ${label} tape now reaches this entry, so it has a natural corpus`);
  }
  console.log("  NEVER DISPATCHED: shared, attract and a turning tape all dispatch it 0 times");
});

test("NUDGED CORPUS: the caller transfers here for real, and no dispatch reaches the destroy path", { skip }, () => {
  const seen = sessions();
  assert.equal(seen.length, TAPES.length, "vacuous: a session is missing from the corpus");
  let total = 0;
  for (const s of seen) {
    assert.ok(s.dispatches > 0, `vacuous: the ${s.label} tape never reached the entry`);
    assert.equal(s.dispatches, NUDGED[s.label], `the ${s.label} nudged dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on a ${s.label} dispatch`);
    assert.equal(s.firstLive, FIRST_LIVE[s.label], `the ${s.label} first-live count moved`);
    assert.equal(s.bothLive, BOTH_LIVE[s.label], `the ${s.label} both-live count moved`);
    assert.equal(s.pastFirstAxis, PAST_FIRST_AXIS[s.label], `the ${s.label} first-axis count moved`);
    assert.equal(
      s.destroyed,
      0,
      `the ${s.label} tape now drives a dispatch through all four tests, so the destroy path IS ` +
        "reachable on real data and this file's central hole has to be re-derived",
    );
    total += s.dispatches;
  }
  console.log(
    `  NUDGED CORPUS: ${total} real dispatches over three sessions, identical on each; ` +
      `${seen.map((s) => `${s.label} ${s.bothLive} both-live / ${s.pastFirstAxis} past axis 1`)
        .join(", ")}; 0 destroys`,
  );
});

test("EQUAL at a nudged dispatch, outside the dead stack window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  destroyPlayerAndMotherShipOnContact(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(
    `  EQUAL: first=${entryState().mem8[PLAYER_STATE]} second=${entryState().mem8[MOTHER_SHIP_STATE]} ` +
      `sp=${hex4(sp)}; identical outside [sp-${SCRATCH_BYTES}, sp)`,
  );
});

test("NOT VACUOUS: a no-op FAILS on a crafted entry, and passes on every real one", { skip }, () => {
  const hit = craft(LIVE, LIVE, INSIDE, INSIDE, INSIDE, INSIDE);
  const d = unitDiff(brokenNoOp, hit);
  assert.notEqual(d, null, "the masked comparison passed a candidate that does nothing, even on a " +
    "crafted entry built to pass all four tests");
  assert.equal(
    unitDiff(brokenNoOp, entryState()),
    null,
    "a real nudged dispatch now catches the empty candidate, so the destroy path IS reached on " +
      "real data and the whole-machine holes recorded above are stale",
  );
  console.log(`  NOT VACUOUS: crafted catches the empty candidate — ${show(d)}; real does not`);
});

test("EXCLUDED, deliberately: bounded over the whole crafted space", { skip }, () => {
  const moved = movedRegisters(destroyPlayerAndMotherShipOnContact);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc; live-out is memory only`);
});

test("THE MASK IS LOAD-BEARING, MEASURED: it is exactly six bytes and it is used", { skip }, () => {
  let unmasked = 0;
  const offsets = new Set();
  overSweep((machine) => {
    const sp = machine.regs.sp;
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    destroyPlayerAndMotherShipOnContact(b);
    const diffs = allDiffs(a, b);
    if (diffs.length === 0) return;
    unmasked++;
    for (const d of diffs) offsets.add(d.addr - sp);
  });
  assert.equal(unmasked, CRAFTED_DESTROYS, "the number of crafted entries an UNMASKED comparison " +
    "rejects moved, so either the mask stopped being needed or the sweep stopped reaching the " +
    "path that needs it");
  assert.deepEqual(
    [...offsets].sort((a, b) => a - b),
    SCRATCH_OFFSETS,
    "the window the oracle dirties below the stack pointer changed shape",
  );
  console.log(
    `  MASK: ${unmasked} of ${SWEEP_SIZE} crafted entries differ unmasked, all inside ` +
      `[sp-${SCRATCH_BYTES}, sp)`,
  );
});

test("EXHAUSTIVE: four state pairs x each axis over 256 coordinates from two bases", { skip }, () => {
  let destroys = 0;
  overSweep((machine) => {
    const a = machine.clone();
    oracle(a);
    if (a.mem8[PLAYER_STATE] === DESTROYED && a.mem8[MOTHER_SHIP_STATE] === DESTROYED) destroys++;
  });
  assert.equal(destroys, CRAFTED_DESTROYS, "the crafted sweep's destroy count moved, so it no " +
    "longer covers what this entry does when the guard holds");
  assert.equal(sweepCaught(destroyPlayerAndMotherShipOnContact), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} comparisons identical, ${destroys} of them destroying`);
});

for (const [label, opts] of TAPES) {
  test(`WHOLE-MACHINE: the ${label} session differs only in the dead stack bytes`, { skip }, () => {
    const r = wholeRunCells(destroyPlayerAndMotherShipOnContact, label, opts);
    assert.equal(r.threw, null, `the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `a run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.equal(r.fired, NUDGED[label], `the ${label} whole-machine dispatch count moved`);
    assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the dead stack bytes");
    console.log(
      `  WHOLE-MACHINE/${label}: ${r.frames} frames, ${r.fired} dispatches, only ` +
        `${r.cells.map(hex4).join(" ")} differ`,
    );
  });
}

test("TEETH/seam: without the omitted-return seam the session dies", { skip }, () => {
  const r = wholeRunCells(destroyPlayerAndMotherShipOnContact, "attract", TAPES[RICHEST][1], (fn) => fn);
  assert.ok(
    r.threw !== null || r.stopped !== null,
    "the run COMPLETED with the seam removed, so the caller of this address no longer expects a " +
      "return and the whole-machine arms above should drop the seam rather than keep it",
  );
  console.log(`  TEETH/seam: the unshimmed rewrite dies — ${r.threw ?? r.stopped}`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, nudgedCaught, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of nudged dispatches`, { skip }, () => {
    const [tapeLabel, opts] = TAPES[RICHEST];
    const r = nudgedSession(twin, opts);
    assert.equal(r.dispatches, NUDGED[tapeLabel], "the session's dispatch count moved");
    assert.equal(r.caught, nudgedCaught, `the ${label} twin's nudged catch count moved`);
    console.log(`  TEETH/${label}: the ${tapeLabel} session catches ${r.caught} of ${r.dispatches}`);
  });

  test(`TEETH: the whole-machine arm sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin, "attract", TAPES[RICHEST][1]);
    const seen = r.threw !== null || r.cells.length > SESSION_SCRATCH.length;
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
    console.log(
      `  TEETH/${label}: whole-machine ${seen ? "catches it" : "is BLIND, as recorded"} — ` +
        `${r.threw ?? `${r.cells.length} cells`}`,
    );
  });
}
