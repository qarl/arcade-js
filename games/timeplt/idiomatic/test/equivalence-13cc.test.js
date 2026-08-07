// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_13cc — memory-equivalent to the frozen oracle at ROM 0x13CC.
 *
 * ★ REACHED BY TWO POKES, AND THE CONTROL SAYS SO. Nothing an undriven or a coin-and-start run
 *   does reaches this: it is one arm of a table indexed by a sequence cell, behind a second cell
 *   that this routine's own first write steps past, so even once the arm is reached it fires once.
 *   The gate holds both cells and lets the game dispatch the routine itself with everything else
 *   coherent; an arm asserts the unpoked run reaches it zero times.
 *
 * GATE: poked-natural dispatch, every captured dispatch replayed, a crafted cross over the two
 *   flags and the two colour cells, a whole-machine replay, and teeth.
 *   1. EQUAL at the real dispatch — the whole dump identical, stack scratch included.
 *   2. NOT VACUOUS — a no-op candidate fails the same diff.
 *   3. EXCLUDED, deliberately, pinned to an exact set. It includes the ALTERNATE register set,
 *      which the original swaps in to hold its row counter; the whole-machine arm is what says
 *      that is dead rather than merely unread here.
 *   4. CORPUS — every dispatch the poked run produces.
 *   5. CRAFTED CROSS — both flags against a spread of colour bytes. REAL PLAY PRESENTS ONE CORNER
 *      OF THIS: the corpus arm asserts that every dispatch arrives with the same flags and the
 *      same colour, so the other three quarters of the cross exist only here.
 *   6. THE TWO DIRECTIONS COVER THE SAME CELLS — the flag that turns the painting round is shown
 *      to change the ORDER and not the result, which is why no twin can be built out of it.
 *   7. THE AREA IS EXACT — the four cells just outside the painted rectangle are asserted to be
 *      untouched, which is what pins its edges.
 *   8. WHOLE-MACHINE — the poked session replayed with the rewrite wired through a measured shim.
 *   9. TEETH — eight twins, each caught on an exact declared count. One is INVISIBLE at the
 *      real dispatch, because the row it forgets already holds the colour being painted.
 *
 * HOLE: holding the sequence cell freezes the sequence, so the poked run repeats one step rather
 *   than progressing. That buys many dispatches of THIS routine and no evidence about what the
 *   game does around it.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-13cc.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { loc_13cc } from "../loc_13cc.js";
import { loc_13cc as oracle } from "../../translated/loc_13cc.js";
import {
  firstStateDiff,
  unitEquivalence,
  wholeMachineEquivalence,
} from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { SCREEN_UNFLIPPED, SEQUENCE_SUBSTEP, ACTIVE_PLAYER } from "../names.js";

const TARGET = 0x13cc;

const NEXT_STEP_CELL = 0xa9f0;
const NEXT_STEP = 5;
const FIRST_PLAYER_COLOUR = 0xad1c;
const SECOND_PLAYER_COLOUR = 0xad2c;
const COUNTDOWN = 0xa9f6;

const FIRST_CELL = 0xa044;
const LAST_CELL = 0xa3be;
const ROW_STRIDE = 32;
const ROWS = 28;
const CELLS_PER_ROW = 27;

/** The two cells the pokes hold: the table index, and the sub-step the arm tests. */
const POKED_SUBSTEP = 14;
const POKED_ARM = 4;
const POKE_FROM_FRAME = 600;

const MOVED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp", "c_", "d_", "e_", "h_", "l_"];
const FRAMES = 1400;
const RET_TSTATES = 10;

/** Measured over the corpus below; a move is a finding. */
const DISPATCHES = 400;

const FLAGS = [0, 1];
const COLOURS = [0x00, 0x01, 0x0f, 0x55, 0xff];
const SWEEP_SIZE = FLAGS.length * FLAGS.length * COLOURS.length * COLOURS.length;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

function factory(overrides, poked = true) {
  const m = makeMachine(overrides);
  if (poked) {
    m.pokes = [
      { addr: SEQUENCE_SUBSTEP, val: POKED_SUBSTEP, frame: POKE_FROM_FRAME, dur: null },
      { addr: NEXT_STEP_CELL, val: POKED_ARM, frame: POKE_FROM_FRAME, dur: null },
    ];
  }
  return m;
}

// ── the entry ───────────────────────────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(factory, TARGET, oracle, (m) => {
    if (entry === null) entry = m.clone();
    return candidate(m);
  }, { maxFrames: FRAMES });
}

function entryState() {
  if (entry === null) gate(loc_13cc);
  return entry;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
}

const caught = (candidate, machine) => unitDiff(candidate, machine) !== null;

const shapeOf = (m) =>
  `${m.mem8[ACTIVE_PLAYER]}/${m.mem8[SCREEN_UNFLIPPED]}/` +
  `${m.mem8[m.mem8[ACTIVE_PLAYER] === 0 ? FIRST_PLAYER_COLOUR : SECOND_PLAYER_COLOUR]}`;

// ── the corpus ──────────────────────────────────────────────────────────────────────────

let corpus = null;
function captureCorpus() {
  if (corpus) return corpus;
  const entries = [];
  const shapes = new Set();
  const m = factory(new Map([[TARGET, (mm) => {
    entries.push(mm.clone());
    shapes.add(shapeOf(mm));
    return oracle(mm);
  }]]));
  const frames = m.runFrames(FRAMES);
  assert.equal(m.stoppedBy, null, `corpus run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, FRAMES, "corpus run ran short");
  corpus = { entries, shapes };
  return corpus;
}

/** A real captured machine with both flags and both colour cells forced. */
function craft(player, unflipped, first, second) {
  const m = entryState().clone();
  m.mem8[ACTIVE_PLAYER] = player;
  m.mem8[SCREEN_UNFLIPPED] = unflipped;
  m.mem8[FIRST_PLAYER_COLOUR] = first;
  m.mem8[SECOND_PLAYER_COLOUR] = second;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const p of FLAGS) {
    for (const u of FLAGS) {
      for (const f of COLOURS) for (const s of COLOURS) out.push([p, u, f, s]);
    }
  }
  crossCache = out;
  return out;
}

const sweepCaught = (candidate) => cross().filter((c) => caught(candidate, craft(...c))).length;

// ── the shim, measured rather than asserted ─────────────────────────────────────────────

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
  wholeMachineEquivalence(factory, FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

const colourOf = (m) =>
  m.mem8[m.mem8[ACTIVE_PLAYER] === 0 ? FIRST_PLAYER_COLOUR : SECOND_PLAYER_COLOUR];

function fill(m, colour, rows, cells) {
  for (let row = 0; row < rows; row++) {
    for (let cell = 0; cell < cells; cell++) m.mem8[FIRST_CELL + ROW_STRIDE * row + cell] = colour;
  }
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: paints and steps but never hands the sequence its next step. */
function brokenNoStep(m) {
  fill(m, colourOf(m), ROWS, CELLS_PER_ROW);
  m.mem8[COUNTDOWN] = m.mem8[COUNTDOWN] - 1;
}

/** BUG: takes the other player's colour, so a two-player game paints the wrong one. */
function brokenWrongPlayer(m) {
  m.mem8[NEXT_STEP_CELL] = NEXT_STEP;
  const colour = m.mem8[m.mem8[ACTIVE_PLAYER] === 0 ? SECOND_PLAYER_COLOUR : FIRST_PLAYER_COLOUR];
  fill(m, colour, ROWS, CELLS_PER_ROW);
  m.mem8[COUNTDOWN] = m.mem8[COUNTDOWN] - 1;
}

/** BUG: one row short, so the last row of the rectangle keeps what it had. */
function brokenOneRowShort(m) {
  m.mem8[NEXT_STEP_CELL] = NEXT_STEP;
  fill(m, colourOf(m), ROWS - 1, CELLS_PER_ROW);
  m.mem8[COUNTDOWN] = m.mem8[COUNTDOWN] - 1;
}

/** BUG: one cell too wide, so each row spills one place past the rectangle's edge. */
function brokenOneCellWide(m) {
  m.mem8[NEXT_STEP_CELL] = NEXT_STEP;
  fill(m, colourOf(m), ROWS, CELLS_PER_ROW + 1);
  m.mem8[COUNTDOWN] = m.mem8[COUNTDOWN] - 1;
}

/** BUG: the countdown is left standing, so whatever waits on it waits forever. */
function brokenNoCountdown(m) {
  m.mem8[NEXT_STEP_CELL] = NEXT_STEP;
  fill(m, colourOf(m), ROWS, CELLS_PER_ROW);
}

/** BUG: the countdown goes up instead of down. */
function brokenCountdownUp(m) {
  m.mem8[NEXT_STEP_CELL] = NEXT_STEP;
  fill(m, colourOf(m), ROWS, CELLS_PER_ROW);
  m.mem8[COUNTDOWN] = m.mem8[COUNTDOWN] + 1;
}

/** BUG: hands the sequence the wrong next step. */
function brokenWrongStep(m) {
  m.mem8[NEXT_STEP_CELL] = NEXT_STEP + 1;
  fill(m, colourOf(m), ROWS, CELLS_PER_ROW);
  m.mem8[COUNTDOWN] = m.mem8[COUNTDOWN] - 1;
}

/** Per twin: exact catch count over the crafted cross, and its verdict at the real dispatch. */
const TWINS = [
  ["no-op", brokenNoOp, 100, true],
  ["no-step", brokenNoStep, 100, true],
  ["wrong-player", brokenWrongPlayer, 80, true],
  ["one-row-short", brokenOneRowShort, 80, false],
  ["one-cell-wide", brokenOneCellWide, 100, true],
  ["no-countdown", brokenNoCountdown, 100, true],
  ["countdown-up", brokenCountdownUp, 100, true],
  ["wrong-step", brokenWrongStep, 100, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("NEGATIVE CONTROL: without the pokes the game never dispatches it", { skip }, () => {
  assert.throws(
    () => unitEquivalence((o) => factory(o, false), TARGET, oracle, loc_13cc, { maxFrames: FRAMES }),
    /never entered/,
    "an unpoked run reached this arm, so the pokes are not what makes it reachable",
  );
  console.log("  CONTROL: zero dispatches in an unpoked run of the same length");
});

test("EQUAL at the real dispatch: loc_13cc == oracle on the whole dump", { skip }, () => {
  const r = gate(loc_13cc);
  assert.notEqual(entry, null, "vacuous: the poked run never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  console.log(`  EQUAL: entry player/flip/colour ${shapeOf(entryState())}; identical`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same diff", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: the alternate register set, the scratch registers and pc", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_13cc(b);
  assert.deepEqual(
    REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
    MOVED,
    "the excluded set changed shape",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${MOVED.join(", ")} and pc`);
});

test("CORPUS: every captured dispatch replays identically, from ONE corner", { skip }, () => {
  const { entries, shapes } = captureCorpus();
  assert.equal(entries.length, DISPATCHES, "the dispatch count moved");
  assert.equal(
    shapes.size,
    1,
    "real play now presents more than one flag-and-colour combination, so the crafted cross " +
      "covers a different hole than this file says",
  );
  for (const captured of entries) {
    assert.equal(unitDiff(loc_13cc, captured), null, "a captured dispatch diverged");
  }
  console.log(`  CORPUS: ${entries.length} dispatches, all at ${[...shapes][0]}`);
});

test("CRAFTED: every flag and colour combination paints identically", { skip }, () => {
  for (const c of cross()) {
    const d = unitDiff(loc_13cc, craft(...c));
    assert.equal(d, null, `${c.join("/")}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${SWEEP_SIZE} combinations identical`);
});

test("THE TWO DIRECTIONS COVER THE SAME CELLS", { skip }, () => {
  const forward = craft(0, 1, 0x3c, 0x3c);
  const backward = craft(0, 0, 0x3c, 0x3c);
  loc_13cc(forward);
  loc_13cc(backward);
  // The flag itself is a cell of the dump and the two machines were built holding different
  // values of it, so it is set back before the comparison; everything else must already agree.
  forward.mem8[SCREEN_UNFLIPPED] = 0;
  const d = firstStateDiff(
    forward.dumpState(),
    backward.dumpState(),
    (off) => forward.stateOffsetToAddr(off),
  );
  assert.equal(
    d,
    null,
    "the two directions left the plane different, so which one runs IS observable and this " +
      "file's account of the flag is wrong",
  );
  console.log("  DIRECTIONS: turning the painting round leaves the plane identical");
});

test("THE AREA IS EXACT: the cells just outside the rectangle are untouched", { skip }, () => {
  const m = craft(0, 1, 0x3c, 0x3c);
  const outside = [
    FIRST_CELL - 1,
    FIRST_CELL + CELLS_PER_ROW,
    FIRST_CELL - ROW_STRIDE,
    LAST_CELL + 1,
    LAST_CELL + ROW_STRIDE,
  ];
  for (const at of outside) m.mem8[at] = 0x99;
  loc_13cc(m);
  for (const at of outside) {
    assert.equal(m.mem8[at], 0x99, `${hex4(at)} was painted, so the rectangle is bigger than stated`);
  }
  assert.equal(m.mem8[FIRST_CELL], 0x3c, "the first cell of the rectangle must be painted");
  assert.equal(m.mem8[LAST_CELL], 0x3c, "and so must the last");
  console.log(`  AREA: ${outside.length} cells outside untouched; both corners painted`);
});

test("WHOLE-MACHINE: the poked session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(loc_13cc);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, FRAMES, "the replay ran short");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(`  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches`);
});

test("TEETH: removing the shim's return kills the run, so the shim is load-bearing", { skip }, () => {
  let died = null;
  try {
    const w = wholeMachineEquivalence(factory, FRAMES, new Map([[TARGET, loc_13cc]]));
    died = w.equal ? null : "forked";
  } catch (e) {
    died = String(e).slice(0, 80);
  }
  assert.notEqual(died, null, "the unshimmed rewrite ran clean, so the shim proves nothing");
  console.log(`  TEETH/shim: the unshimmed rewrite dies — ${died}`);
});

for (const [label, twin, swept, seenAtDispatch] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), swept, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${swept} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin at the real dispatch, hole pinned`, { skip }, () => {
    const seen = caught(twin, entryState());
    assert.equal(seen, seenAtDispatch, `the real dispatch's view of the ${label} twin moved`);
    console.log(`  TEETH/${label}: real dispatch ${seen ? "catches it" : "is BLIND, as recorded"}`);
  });
}
