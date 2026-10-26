// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceCharCursor — memory-equivalent to the frozen oracle at ROM 0x0020.
 *
 * GATE: unit-capture on the real dispatch, but the comparison is RAM **plus a declared
 *   live-out**, because RAM ALONE IS VACUOUS FOR THIS ROUTINE. It writes nothing; the whole
 *   effect is the cursor it leaves behind. `unitEquivalence` therefore reports `ram: null` for
 *   a bare `() => {}` as readily as for the real thing, and a test asserting only that would be
 *   green and worthless. The BLIND arm below makes that an assertion rather than a caveat.
 *
 * LIVE-OUT, derived from the callers rather than from the instruction sequence. Eleven routines
 *   reach this one. Every call site holds a tilemap address in the cursor pair across the call
 *   and writes a character code through it, so the pair is live everywhere — and the CORPUS arm
 *   confirms the pair really is a tilemap address at every dispatch the game makes. The
 *   accumulator is not live: at most sites it is reloaded within an instruction or two, at one
 *   it is exchanged into the shadow set and that copy is never brought back, and at five it
 *   flows out through a return, where reading further would mean walking the call graph rather
 *   than the callers. No site tests the flags this routine leaves before overwriting them.
 *
 *   Reading stops at those five sites, so MEASUREMENT finishes the job — see LIVE-OUT (MEASURED)
 *   below. EXCLUDED is {a, f, sp}, pinned by name so it cannot silently widen, and `pc` diverges
 *   too: the oracle ends by popping a return address into the program counter and the rewrite,
 *   which is ordinary JavaScript, does not.
 *
 * THE STACK IS NOT MODELLED, AND THAT COSTS SOMETHING MEASURABLE. The idiomatic layer lets the
 *   host language own the call stack, so this routine does not consume the return address its
 *   callers push. Substituting it one-for-one into the still-translated engine therefore leaks
 *   two bytes per dispatch and the engine dies on a stale return address. That is the known
 *   mixed-migration leak, not a defect here, and it resolves when the callers stop pushing —
 *   i.e. when they are idiomatic too. EXPECTED DIVERGENCE below pins the measurement so the
 *   claim is checked rather than asserted, and LIVE-OUT (MEASURED) shows that the leak is the
 *   ONLY thing the missing return was buying.
 *
 * `r.equal` is unused and stays false by design — it folds in the register diff that
 *   memory-equivalence deliberately drops.
 *
 * What it exercises, holes stated:
 *   1. BLIND — the RAM half is proven vacuous, so it cannot be mistaken for the gate.
 *   2. EQUAL at the real dispatch — RAM identical AND the live-out identical.
 *   3. EXCLUDED — nothing outside {a, f, sp} moves, plus pc; the cursor does not.
 *   4. EXHAUSTIVE — all 65536 cursor values. The routine reads nothing else, so this is its
 *      entire input space, and it is the only arm that covers the borrow into the high byte.
 *   5. CORPUS — every cursor the running game really presents over a driven tape, replayed.
 *   6. EXPECTED DIVERGENCE — the stack leak, measured and recorded.
 *   7. LIVE-OUT (MEASURED) — the dropped accumulator and flags reach nothing the display reads.
 *   8. TEETH — four broken twins with exact catch counts. One is caught only by the sweep and
 *      the corpus, and that blindness is asserted rather than left implicit.
 *
 * HOLE: the corpus is one tape. It reaches live play, but not every screen the game can draw.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0020.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { loc_0020 as oracle } from "../../translated/loc_0020.js";
import { deadStackBelow, firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { recordFrameFloors } from "./_frameFloor.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x0020;
const LIVE_OUT = ["d", "e"];
const EXCLUDED = ["a", "f", "sp"];
const CURSOR_SPACE = 65536;

// ENTRY_FRAMES is enough to ENTER, which is all the unit arm needs. The corpus and the two
// driven-run arms want a longer run, declared here rather than raised in the shared harness.
const CORPUS_FRAMES = 1800;
const WORK_RAM_TOP = 0xafff;

const OPTS = romsPresent() ? {} : { skip: "ROM images are gitignored; assemble them to run" };

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/**
 * The routine wrapped in the translated engine's calling convention, for the two driven-run
 * arms only. Nothing in the shipped layer looks like this: the wrapper exists so an experiment
 * can be run INSIDE an engine whose callers still push a return address, and the difference
 * between running with it and without it is precisely what those two arms measure.
 */
const substitutable = (fn) => (m) => {
  fn(m);
  return m.ret();
};

let entry = null;

/** unitEquivalence with the pristine entry harvested off the candidate arm's own clone. */
function rawGate(candidate) {
  return unitEquivalence(
    makeMachine,
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
  if (entry === null) rawGate(advanceCharCursor);
  return entry;
}

/** Oracle vs candidate from the real entry, with the cursor forced to `cursor`. */
function liveOutDiff(candidate, cursor) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.regs.de = cursor;
  b.regs.de = cursor;
  oracle(a);
  candidate(b);
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** The whole comparison the real arm passes: the RAM half AND the live-out half. */
function gate(candidate) {
  const r = rawGate(candidate);
  return { ram: r.ram, live: liveOutDiff(candidate, entryState().regs.de) };
}

const show = (d) => (d ? `${d.reg ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/**
 * Replay a list of cursor values through both sides on two long-lived machines. Cloning per
 * value costs a tenth of a millisecond, which 65536 values cannot afford; reusing two machines
 * is only sound if neither side writes memory, so the caller is handed the RAM diff to check.
 * The stack pointer is re-seated every iteration because the ORACLE pops one on the way out and
 * would otherwise walk it clean off the stack over the course of a sweep.
 */
function replay(candidate, cursors) {
  const a = entryState().clone();
  const b = entryState().clone();
  const sp = entryState().regs.sp;
  const pristine = entryState().dumpState();
  let caught = 0;
  let first = null;
  for (const cursor of cursors) {
    a.regs.sp = sp;
    a.regs.de = cursor;
    b.regs.sp = sp;
    b.regs.de = cursor;
    oracle(a);
    candidate(b);
    if (a.regs.d !== b.regs.d || a.regs.e !== b.regs.e) {
      caught++;
      if (first === null) first = { cursor, oracleCursor: a.regs.de, candidateCursor: b.regs.de };
    }
  }
  const addrOf = (o) => a.stateOffsetToAddr(o);
  return {
    caught,
    first,
    wroteA: firstStateDiff(pristine, a.dumpState(), addrOf),
    wroteB: firstStateDiff(pristine, b.dumpState(), addrOf),
  };
}

const everyCursor = () => ({ *[Symbol.iterator]() { for (let i = 0; i < CURSOR_SPACE; i++) yield i; } });

/** Every cursor value the running game presents to this routine over the driven tape. */
let corpusCache = null;
function corpus() {
  if (corpusCache === null) {
    const cursors = [];
    const m = makeMachine(new Map([[TARGET, (mm) => { cursors.push(mm.regs.de); return oracle(mm); }]]));
    m.runFrames(CORPUS_FRAMES);
    corpusCache = cursors;
  }
  return corpusCache;
}

/**
 * Wire a candidate into a driven run and diff every frame against the all-oracle baseline.
 * Divergence in the stack window below the SP of that frame's sample is the dead scratch the contract excludes; anything else
 * has ESCAPED. A run that stops early reports how far it got instead.
 */
function drivenRun(candidate) {
  let lowestSp = 0xffff;
  const base = makeMachine(
    new Map([[TARGET, (m) => {
      if (m.regs.sp < lowestSp) lowestSp = m.regs.sp;
      return oracle(m);
    }]]),
  );
  const floors = recordFrameFloors(base);
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  assert.equal(base.stoppedBy, null, `the baseline itself stopped early: ${base.stoppedBy}`);

  let calls = 0;
  const opt = makeMachine(new Map([[TARGET, (m) => { calls++; return candidate(m); }]]));
  const optFrames = opt.runFrames(CORPUS_FRAMES);

  const escaped = new Set();
  const scratch = new Set();
  const compared = Math.min(baseFrames.length, optFrames.length);
  for (let f = 0; f < compared; f++) {
    const a = baseFrames[f];
    const b = optFrames[f];
    const dead = deadStackBelow({ lo: lowestSp, hi: WORK_RAM_TOP + 1 }, floors[f]); // live from the sample's SP up
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = base.stateOffsetToAddr(i);
      if (dead(addr)) scratch.add(addr);
      else escaped.add(addr);
    }
  }
  return {
    escaped: [...escaped].sort((x, y) => x - y),
    scratch: [...scratch].sort((x, y) => x - y),
    stopped: opt.stoppedBy ? String(opt.stoppedBy) : null,
    reached: optFrames.length,
    compared,
    calls,
    lowestSp,
  };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("BLIND: the RAM half of the comparison cannot fail — a no-op passes it", OPTS, () => {
  const r = rawGate(() => {});
  assert.equal(
    r.ram,
    null,
    "the RAM diff CAUGHT a no-op, so this routine writes memory after all and every " +
      "live-out claim in this file must be re-derived from scratch",
  );
  console.log("  BLIND: RAM is vacuous here — the live-out half below is the whole gate");
});

test("EQUAL at the real dispatch: advanceCharCursor == oracle on RAM and the live-out", OPTS, () => {
  const r = gate(advanceCharCursor);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.equal(r.live, null, `the live-out diverged — ${show(r.live)}`);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  console.log(`  EQUAL: entry cursor ${hex4(entryState().regs.de)}; RAM and cursor identical`);
});

test("EXCLUDED, deliberately: the accumulator, the flags and the stack pointer", OPTS, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  advanceCharCursor(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register outside the declared excluded set moved");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops a return address and the rewrite does not");
  assert.equal(a.regs.de, b.regs.de, "the one live-out");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc — the cursor matches`);
});

test("EXHAUSTIVE: all 65536 cursor values step as the oracle steps them", OPTS, () => {
  const r = replay(advanceCharCursor, everyCursor());
  assert.equal(r.caught, 0, `diverged on ${r.caught} cursor(s), first ${JSON.stringify(r.first)}`);
  assert.equal(r.wroteA, null, `the oracle wrote memory during the sweep — ${show(r.wroteA)}`);
  assert.equal(r.wroteB, null, `the rewrite wrote memory during the sweep — ${show(r.wroteB)}`);

  const wrapped = entryState().clone();
  wrapped.regs.de = 0x0000;
  advanceCharCursor(wrapped);
  assert.equal(wrapped.regs.de, 0xffe0, "the step must wrap to sixteen bits, not go negative");
  console.log(`  EXHAUSTIVE: ${CURSOR_SPACE} cursors identical, no memory written by either side`);
});

test("CORPUS: every cursor the running game presents is stepped identically", OPTS, () => {
  const cursors = corpus();
  assert.ok(cursors.length > 0, "vacuous: the tape never dispatched the routine");
  const borrowing = cursors.filter((c) => (c & 0xff) < 32).length;
  assert.ok(borrowing > 0, "vacuous: the corpus never exercises the borrow into the high byte");
  const pages = new Set(cursors.map((c) => c >> 8));
  const r = replay(advanceCharCursor, cursors);
  assert.equal(r.caught, 0, `diverged on ${r.caught} real cursor(s), first ${JSON.stringify(r.first)}`);
  console.log(
    `  CORPUS: ${cursors.length} real dispatches over ${CORPUS_FRAMES} frames, ` +
      `${new Set(cursors).size} distinct cursors, ${borrowing} of them borrowing; ` +
      `pages ${[...pages].sort().map((p) => hex4(p << 8)).join(" ")}`,
  );
});

// ── the stack, and what dropping it does and does not cost ──────────────────────────────

test("EXPECTED DIVERGENCE: substituted as-is, the engine leaks stack and gives up", OPTS, () => {
  const r = drivenRun(advanceCharCursor);
  assert.notEqual(
    r.stopped,
    null,
    "the driven run COMPLETED with the bare rewrite wired in. That is good news, not a " +
      "failure: the callers no longer push a return address, so the leak recorded here is " +
      "gone and this arm has outlived its purpose. Delete it.",
  );
  assert.match(
    r.stopped,
    /no routine registered/,
    "the run still stops early but for a different reason than the stale return address " +
      "this arm exists to record — re-derive before trusting the note",
  );
  assert.ok(r.reached < CORPUS_FRAMES, "a run that stopped early cannot have reached every frame");
  console.log(
    `  EXPECTED DIVERGENCE: reached frame ${r.reached} of ${CORPUS_FRAMES} after ${r.calls} ` +
      `dispatches, leaking two bytes each — ${r.stopped}`,
  );
});

test("LIVE-OUT (MEASURED): supply the return and nothing the display reads diverges", OPTS, () => {
  const r = drivenRun(substitutable(advanceCharCursor));
  assert.equal(r.stopped, null, `the driven run stopped early even with the return supplied: ${r.stopped}`);
  assert.equal(r.compared, CORPUS_FRAMES, "the run did not reach the frames it was asked for");
  assert.ok(r.calls > 0, "vacuous: the rewrite was never dispatched");
  assert.deepEqual(
    r.escaped.map(hex4),
    [],
    "a divergence reached memory outside the dead stack scratch — the dropped accumulator or " +
      "flags are live somewhere after all, and EXCLUDED is wrong",
  );
  console.log(
    `  LIVE-OUT (MEASURED): ${r.calls} dispatches over ${r.compared} frames; divergence confined ` +
      `to ${r.scratch.length} cell(s) in the stack window above ${hex4(r.lowestSp)}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Four plausible ways to get this routine wrong. Three are caught by every arithmetic arm; the
// fourth is invisible at the captured entry, and that is asserted below rather than left for a
// reader to assume.

/** BUG: does nothing — the tell that a gate is measuring an unreached or vacuous routine. */
function brokenNoOp() {}

/** BUG: steps by thirty-one, so the cursor drifts one cell per character drawn. */
function brokenOffByOne(m) {
  m.regs.de = (m.regs.de - 31) & 0xffff;
}

/** BUG: steps the wrong way, so a line of characters is drawn backwards. */
function brokenWrongWay(m) {
  m.regs.de = (m.regs.de + 32) & 0xffff;
}

/** BUG: steps the low byte only and never borrows into the high byte. */
function brokenNoBorrow(m) {
  m.regs.e = (m.regs.e - 32) & 0xff;
}

const ALWAYS_CAUGHT = [
  ["no-op", brokenNoOp, CURSOR_SPACE],
  ["off-by-one", brokenOffByOne, CURSOR_SPACE],
  ["wrong-way", brokenWrongWay, CURSOR_SPACE],
];

for (const [label, twin, expected] of ALWAYS_CAUGHT) {
  test(`TEETH: the ${label} twin is CAUGHT at the real dispatch`, OPTS, () => {
    const r = gate(twin);
    assert.notEqual(r.live, null, `the gate PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught at the entry — ${show(r.live)}`);
  });

  test(`TEETH: the ${label} twin is CAUGHT on every cursor`, OPTS, () => {
    const r = replay(twin, everyCursor());
    assert.equal(r.caught, expected, `the sweep missed the ${label} twin somewhere`);
    console.log(`  TEETH/${label}: caught on all ${r.caught} cursors`);
  });
}

test("TEETH: the no-borrow twin is INVISIBLE at the captured entry and caught by the sweep", OPTS, () => {
  assert.ok(
    (entryState().regs.de & 0xff) >= 32,
    "the captured entry now borrows, so this arm no longer demonstrates the hole it exists for",
  );
  const atEntry = gate(brokenNoBorrow);
  assert.equal(atEntry.ram, null, "RAM is vacuous, as the BLIND arm establishes");
  assert.equal(
    atEntry.live,
    null,
    "the captured entry caught the no-borrow twin — the hole this arm documents has closed",
  );

  // 32 low bytes borrow, times 256 high bytes: the sweep is what covers the arm the real
  // entry cannot reach, and it must catch the twin on exactly those and no others.
  const r = replay(brokenNoBorrow, everyCursor());
  assert.equal(r.caught, 32 * 256, "the sweep did not catch the twin on exactly the borrowing cursors");
  console.log(`  TEETH/no-borrow: invisible at the entry, caught on ${r.caught} borrowing cursors`);
});

test("TEETH: the no-borrow twin is CAUGHT by the corpus and by the measured driven run", OPTS, () => {
  const r = replay(brokenNoBorrow, corpus());
  assert.ok(r.caught > 0, "the corpus missed the no-borrow twin");

  // Without a tooth of its own, "divergence confined to the stack window" could mean the
  // driven-run comparison simply cannot see anything. It can.
  const w = drivenRun(substitutable(brokenNoBorrow));
  assert.ok(
    w.stopped !== null || w.escaped.length > 0,
    "the measured driven run PASSED the no-borrow twin, so its confinement result is vacuous",
  );
  console.log(
    `  TEETH/no-borrow: caught on ${r.caught} real cursors; measured driven run ` +
      `${w.stopped ? "stopped early" : `escaped to ${w.escaped.slice(0, 4).map(hex4).join(" ")}`}`,
  );
});
