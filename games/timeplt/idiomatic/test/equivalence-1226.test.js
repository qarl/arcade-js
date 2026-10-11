// SPDX-License-Identifier: GPL-3.0-only
/**
 * handPlayOverToOtherPlayer — memory-equivalent to the frozen oracle at ROM 0x1226.
 *
 * WHAT IT IS. Three stores and no reads worth the name: a one-bit selector is toggled in place, a
 * countdown cell is re-armed with a fixed span, and the inner sequence index is loaded from a byte
 * of the program image rather than from an immediate. Nothing is returned and nothing is compared.
 *
 * ★ NO TAPE IN THIS CORPUS DISPATCHES THIS ENTRY, and the first arm asserts it. Its one caller IS
 *   reached — once per driven session — but that caller transfers here only when the cell it
 *   selects is non-zero, and on every tape that cell is zero. That is a fact about the corpus and
 *   NOT about the game: no tape here presses the two-player start button, and the cell the caller
 *   selects is the OTHER player's, which a one-player start leaves at zero for the whole game. So the corpus is MADE: the selected cell is armed to one
 *   at the caller's own dispatch, identically on both sides of every comparison, and the caller
 *   then transfers here for real, on a real machine, from its real call site. That is a crafted
 *   entry in the strict sense — a real state with one surgical nudge — not a fabricated one.
 *
 * GATE: armed real dispatches plus an exhaustive crafted sweep of the entry's whole input space,
 *   with a whole-machine replay. What it exercises, holes stated:
 *
 *   1. NEVER DISPATCHED — three tapes, zero dispatches each; the caller's own counts asserted too.
 *   2. ARMED CORPUS — with the cell armed the entry really is dispatched, and every dispatch
 *      replays identically. The attract tape never reaches the caller, so it contributes NOTHING
 *      and the arm asserts that zero rather than letting it read as coverage.
 *   3. EQUAL at the armed dispatch with NOTHING MASKED. This entry pushes nothing, so there is no
 *      dead stack window to exclude and the comparison is over the whole dumped state.
 *   4. NOT VACUOUS — a candidate that does nothing FAILS the same comparison.
 *   5. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      space, asserted to stay inside the allowed set.
 *   6. THE FETCHED BYTE — the index is not an immediate, so the arm reads it through the machine's
 *      own memory map and asserts both what it is and that it comes from below the RAM window.
 *   7. EXHAUSTIVE — all 256 selector values against three entry accumulators. The selector is the
 *      only cell this entry reads, so 256 values IS its whole input space; the accumulators are
 *      there because the armed dispatch happens to arrive holding the value the oracle leaves.
 *   8. WHOLE-MACHINE — the two sessions that reach the caller, the rewrite wired through the
 *      omitted-return seam, compared frame by frame for their whole length.
 *   9. TEETH/seam — the same wiring with the seam removed, which must die or diverge outside the
 *      dead stack bytes.
 *  10. TEETH — eight twins, each with an exact crafted count, an exact per-tape armed count, and a
 *      recorded whole-machine verdict.
 *
 * HOLE: one armed dispatch per session, and the same one in both sessions — same selector, same
 * accumulator, same stack pointer. The real corpus therefore discriminates almost nothing on its
 * own; the exhaustive sweep is the load-bearing arm and the per-twin counts say so, two of the
 * eight twins being invisible to every armed dispatch and to the whole-machine arm alike.
 * HOLE: the corpus exists only because a cell was armed. Nothing here shows that the game ever
 * arms that cell itself, so this file says what the entry DOES and not when the game runs it.
 * HOLE: the whole-machine arm runs the attract tape not at all, because the caller is never
 * reached there and wiring the rewrite over an address nothing dispatches would pass vacuously.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-1226.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { ROUTINES as ORACLE_ROUTINES } from "../../routines.js";
import { withOmittedRet } from "../../machine.js";
import { handPlayOverToOtherPlayer } from "../handPlayOverToOtherPlayer.js";
import { loc_1226 as oracle } from "../../translated/loc_1226.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { SEQUENCE_SUBSTEP, ACTIVE_PLAYER, SEQUENCE_DELAY, PLAYER_TWO_LIVES } from "../names.js";

const TARGET = 0x1226;
/** The only site that transfers here, and the only place a real entry can be taken from. */
const CALLER = 0x12e7;

const COUNTDOWN_SPAN = 90;
const SUBSTEP_SOURCE = 0x4b52;
const SUBSTEP_SOURCE_BYTE = 1;
const RAM_BASE = 0xa800;

/** The cell the caller tests when the selector is zero; arming it is what makes the corpus. */

const EXCLUDED = ["a", "f", "sp"];

const CORPUS_FRAMES = 3000;
/** Armed dispatches per tape, in TAPES order. Measured; a move here is a finding. */
const ARMED = { shared: 1, attract: 0, turning: 1 };
/** Natural dispatches of the CALLER per tape. Measured. */
const CALLER_DISPATCHES = { shared: 1, attract: 0, turning: 1 };
/** The dead bytes the omitted-return seam leaves differing over a whole session. Measured. */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const IN0 = 0xc300;
const IN1 = 0xc320;
const COIN = 0x01;
const START = 0x08;
const HOLD = 8;

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

const turnTape = () => [
  { frame: 401, port: IN0, bits: COIN, dur: HOLD },
  { frame: 501, port: IN0, bits: START, dur: HOLD },
  { frame: 601, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  { frame: 700, port: IN1, bits: 0x05, dur: CORPUS_FRAMES },
];

const TAPES = [
  ["shared", {}],
  ["attract", { tape: [] }],
  ["turning", { tape: turnTape() }],
];

// ── the comparison ──────────────────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** Nothing is masked: this entry pushes nothing, so every differing byte is a real divergence. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

/** Arm the cell the caller selects, so the caller transfers here on a real machine. */
const armCaller = () => {
  const original = ORACLE_ROUTINES.get(CALLER);
  return (mm) => {
    mm.mem8[PLAYER_TWO_LIVES] = 1;
    return original(mm);
  };
};

function armedSession(candidate, opts) {
  let dispatches = 0;
  let caught = 0;
  let first = null;
  const selectors = new Set();
  const m = makeMachine(
    new Map([
      [CALLER, armCaller()],
      [TARGET, (mm) => {
        dispatches++;
        selectors.add(mm.mem8[ACTIVE_PLAYER]);
        if (first === null) first = mm.clone();
        if (unitDiff(candidate, mm)) caught++;
        return oracle(mm);
      }],
    ]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, first, selectors };
}

let cache = null;
const sessions = () =>
  (cache ??= TAPES.map(([label, opts]) => ({ label, ...armedSession(handPlayOverToOtherPlayer, opts) })));

function entryState() {
  const s = sessions()[0];
  assert.notEqual(s.first, null, "vacuous: arming the cell did not reach the entry");
  return s.first;
}

// ── the crafted space ───────────────────────────────────────────────────────────────────

const SELECTORS = Array.from({ length: 256 }, (_unused, s) => s);
/** The armed dispatch arrives holding the value the oracle leaves, which would hide a live-out. */
const ACCUMULATORS = [0, 1, 255];
const SWEEP_SIZE = SELECTORS.length * ACCUMULATORS.length;

function craft(selector, accumulator) {
  const m = entryState().clone();
  m.mem8[ACTIVE_PLAYER] = selector;
  m.regs.a = accumulator;
  return m;
}

function overSweep(fn) {
  for (const accumulator of ACCUMULATORS) {
    for (const selector of SELECTORS) fn(craft(selector, accumulator));
  }
}

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
    const m = makeMachine(new Map([[CALLER, armCaller()]]), opts);
    const frames = m.runFrames(CORPUS_FRAMES);
    baselines.set(label, { frames, toAddr: (o) => m.stateOffsetToAddr(o), stopped: m.stoppedBy });
  }
  return baselines.get(label);
}

function wholeRunCells(candidate, label, opts, shim = withOmittedRet) {
  const base = baseline(label, opts);
  let fired = 0;
  const host = makeMachine(
    new Map([[CALLER, armCaller()], [TARGET, shim((mm) => (fired++, candidate(mm)))]]),
    opts,
  );
  let hostFrames = [];
  let threw = null;
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
  return {
    cells: [...cells].sort((a, b) => a - b),
    frames: n,
    fired,
    threw,
    stopped: base.stopped ?? host.stoppedBy ?? null,
  };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────
// Eight ways to get three stores wrong: three about the selector's arithmetic, two about the
// re-armed span, two about where the index comes from, and one that puts the pair in each
// other's cells.

const u8 = (v) => v & 0xff;
const toggled = (m) => (m.mem8[ACTIVE_PLAYER] + 1) & 1;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the selector is incremented without being reduced to its one bit, so it counts up. */
function brokenSelectorUnmasked(m) {
  m.mem8[ACTIVE_PLAYER] = u8(m.mem8[ACTIVE_PLAYER] + 1);
  m.mem8[SEQUENCE_DELAY] = COUNTDOWN_SPAN;
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SUBSTEP_SOURCE];
}

/** BUG: the selector is cleared rather than flipped, so it never alternates. */
function brokenSelectorCleared(m) {
  m.mem8[ACTIVE_PLAYER] = 0;
  m.mem8[SEQUENCE_DELAY] = COUNTDOWN_SPAN;
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SUBSTEP_SOURCE];
}

/** BUG: the countdown is re-armed one short. */
function brokenSpanOffByOne(m) {
  m.mem8[ACTIVE_PLAYER] = toggled(m);
  m.mem8[SEQUENCE_DELAY] = COUNTDOWN_SPAN - 1;
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SUBSTEP_SOURCE];
}

/** BUG: the countdown is left as it was, so whatever was running is not restarted. */
function brokenNoCountdown(m) {
  m.mem8[ACTIVE_PLAYER] = toggled(m);
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[SUBSTEP_SOURCE];
}

/** BUG: the index is zeroed instead of taking the fetched byte. */
function brokenSubstepZeroed(m) {
  m.mem8[ACTIVE_PLAYER] = toggled(m);
  m.mem8[SEQUENCE_DELAY] = COUNTDOWN_SPAN;
  m.mem8[SEQUENCE_SUBSTEP] = 0;
}

/** BUG: the index is taken from the selector it just wrote, which agrees by accident. */
function brokenSubstepFromSelector(m) {
  m.mem8[ACTIVE_PLAYER] = toggled(m);
  m.mem8[SEQUENCE_DELAY] = COUNTDOWN_SPAN;
  m.mem8[SEQUENCE_SUBSTEP] = m.mem8[ACTIVE_PLAYER];
}

/** BUG: the span and the fetched byte go into each other's cells. */
function brokenCellsSwapped(m) {
  m.mem8[ACTIVE_PLAYER] = toggled(m);
  m.mem8[SEQUENCE_SUBSTEP] = COUNTDOWN_SPAN;
  m.mem8[SEQUENCE_DELAY] = m.mem8[SUBSTEP_SOURCE];
}

/**
 * Per twin: its exact catch count over the crafted space, its exact catch count on each tape's
 * armed dispatches, and whether the whole-machine arm sees it. Every number is measured and
 * asserted as an equality, so a twin caught on the WRONG set fails as loudly as one missed.
 */
const TWINS = [
  ["no-op", brokenNoOp, 768, [1, 0, 1], true],
  ["selector-unmasked", brokenSelectorUnmasked, 762, [0, 0, 0], false],
  ["selector-cleared", brokenSelectorCleared, 384, [1, 0, 1], true],
  ["span-off-by-one", brokenSpanOffByOne, 768, [1, 0, 1], true],
  ["no-countdown", brokenNoCountdown, 768, [1, 0, 1], true],
  ["substep-zeroed", brokenSubstepZeroed, 768, [1, 0, 1], true],
  ["substep-from-selector", brokenSubstepFromSelector, 384, [0, 0, 0], false],
  ["cells-swapped", brokenCellsSwapped, 768, [1, 0, 1], true],
];

/** The tapes whose caller is reached, and so the only ones a whole-machine arm can run on. */
const DRIVEN = TAPES.filter(([label]) => ARMED[label] > 0);

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("NEVER DISPATCHED: no tape reaches this entry, which is why the corpus is armed", { skip }, () => {
  for (const [label, opts] of TAPES) {
    let hits = 0;
    let callerHits = 0;
    const original = ORACLE_ROUTINES.get(CALLER);
    const m = makeMachine(
      new Map([
        [TARGET, (mm) => (hits++, oracle(mm))],
        [CALLER, (mm) => (callerHits++, original(mm))],
      ]),
      opts,
    );
    m.runFrames(CORPUS_FRAMES);
    assert.equal(hits, 0, `the ${label} tape now reaches this entry, so it has a natural corpus`);
    assert.equal(callerHits, CALLER_DISPATCHES[label], `the ${label} caller count moved`);
  }
  console.log("  NEVER DISPATCHED: 0 natural dispatches on three tapes; the caller fires 1, 0, 1");
});

test("ARMED CORPUS: the caller really does transfer here, and every dispatch is identical", { skip }, () => {
  const seen = sessions();
  assert.equal(seen.length, TAPES.length, "vacuous: a session is missing from the corpus");
  let total = 0;
  for (const s of seen) {
    assert.equal(s.dispatches, ARMED[s.label], `the ${s.label} armed dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on a ${s.label} dispatch`);
    total += s.dispatches;
  }
  assert.ok(total > 0, "vacuous: arming the cell reached the entry on no tape at all");
  assert.equal(ARMED.attract, 0, "the attract tape now reaches the caller, so it is no longer a " +
    "recorded hole and its dispatches have to be counted as corpus");
  const selectors = new Set(seen.flatMap((s) => [...s.selectors]));
  assert.deepEqual([...selectors], [0], "the armed dispatches now present a second selector value, " +
    "so the sweep is no longer the only thing covering the other arm");
  console.log(`  ARMED CORPUS: ${total} real dispatches over two driven sessions, identical on each`);
});

test("EQUAL at the armed dispatch, with NOTHING masked", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  handPlayOverToOtherPlayer(b);
  assert.deepEqual(allDiffs(a, b), [], "a byte of the dumped state diverged");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops its return address; the rewrite does not");
  console.log(
    `  EQUAL: selector=${entryState().mem8[ACTIVE_PLAYER]} countdown=${entryState().mem8[SEQUENCE_DELAY]} ` +
      `index=${entryState().mem8[SEQUENCE_SUBSTEP]} sp=${hex4(entryState().regs.sp)}; identical`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the comparison passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: bounded over the whole crafted space", { skip }, () => {
  const moved = movedRegisters(handPlayOverToOtherPlayer);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register outside the excluded set diverged");
  console.log(
    `  EXCLUDED: ${EXCLUDED.join(", ")} and pc; there is no live-out but memory; ` +
      `measured ${moved.join(", ")}`,
  );
});

test("THE FETCHED BYTE: the index comes from the program image, not an immediate", { skip }, () => {
  const m = entryState();
  assert.ok(SUBSTEP_SOURCE < RAM_BASE, "the source cell moved into the RAM window, so it is no " +
    "longer a fixed byte and the rewrite may not treat it as one");
  assert.equal(m.mem8[SUBSTEP_SOURCE], SUBSTEP_SOURCE_BYTE, "the fetched byte changed value");
  const before = m.mem8[SUBSTEP_SOURCE];
  const probe = m.clone();
  assert.throws(
    () => {
      probe.mem8[SUBSTEP_SOURCE] = before ^ 0xff;
    },
    /unmapped write/,
    "the source cell took a write, so it is not the read-only image this entry reads and the " +
      "rewrite is free to treat the byte as a constant after all",
  );
  console.log(`  FETCHED BYTE: ${hex4(SUBSTEP_SOURCE)} reads ${before} and refuses a write`);
});

test("EXHAUSTIVE: all 256 selector values against three entry accumulators", { skip }, () => {
  assert.equal(sweepCaught(handPlayOverToOtherPlayer), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} comparisons identical`);
});

for (const [label, opts] of DRIVEN) {
  test(`WHOLE-MACHINE: the ${label} session differs only in the dead stack bytes`, { skip }, () => {
    const r = wholeRunCells(handPlayOverToOtherPlayer, label, opts);
    assert.equal(r.threw, null, `the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `a run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.equal(r.fired, ARMED[label], `the ${label} whole-machine dispatch count moved`);
    assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the dead stack bytes");
    console.log(
      `  WHOLE-MACHINE/${label}: ${r.frames} frames, ${r.fired} dispatch, only ` +
        `${r.cells.map(hex4).join(" ")} differ`,
    );
  });
}

test("TEETH/seam: without the omitted-return seam the session dies or diverges", { skip }, () => {
  const r = wholeRunCells(handPlayOverToOtherPlayer, "shared", {}, (fn) => fn);
  const diverged = r.cells.length > SESSION_SCRATCH.length;
  assert.ok(
    r.threw !== null || r.stopped !== null || diverged,
    "the run matched the oracle with the seam removed, so the caller of this address no longer " +
      "expects a return and the whole-machine arms above should drop the seam rather than keep it",
  );
  console.log(
    `  TEETH/seam: the unshimmed rewrite ${diverged ? `diverges in ${r.cells.length} cells` : "dies"} — ` +
      `${r.threw ?? r.stopped ?? r.cells.slice(0, 4).map(hex4).join(" ")}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, perTape, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of armed dispatches`, { skip }, () => {
    const counts = TAPES.map(([, opts]) => armedSession(twin, opts));
    for (const [i, r] of counts.entries()) {
      assert.equal(r.dispatches, ARMED[TAPES[i][0]], "the armed dispatch count moved");
      assert.equal(r.caught, perTape[i], `the ${label} twin's ${TAPES[i][0]} catch count moved`);
    }
    console.log(`  TEETH/${label}: armed sessions catch ${counts.map((r) => r.caught).join("/")}`);
  });

  test(`TEETH: the whole-machine arm sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin, "shared", {});
    const seen = r.threw !== null || r.cells.length > SESSION_SCRATCH.length;
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
    console.log(
      `  TEETH/${label}: whole-machine ${seen ? "catches it" : "is BLIND, as recorded"} — ` +
        `${r.threw ?? `${r.cells.length} cells`}`,
    );
  });
}
