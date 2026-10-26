// SPDX-License-Identifier: GPL-3.0-only
/**
 * drawKillMeter — memory-equivalent to the frozen oracle at ROM 0x0809.
 *
 * WHAT IT IS. Two work-RAM cells in, a run of character cells out: an era selects a ten-byte row,
 * a count selects both how many cells are laid and which end glyph closes the run. Two of the
 * three table reads go through the already-decompiled fetchTableByte and offsetAddress, so both
 * transfers are dissolved into direct calls here.
 *
 * ★ THE WHOLE INPUT SPACE IS TWO BYTES, so this gate does not sample it — it sweeps it. Eight era
 *   values (three more than the five the game uses, which is what covers a row index running off
 *   the end of the table) crossed with all 256 counts is every state the routine can be called in
 *   bar the priors of the cells it writes.
 *
 * ★ THE ORACLE BRACKETS ITS TWO TABLE READS WITH RETURN ADDRESSES AND THE REWRITE DOES NOT, so the
 *   bytes just below the entry stack pointer are dead scratch on one side only. The window is
 *   measured and pinned by every arm.
 *
 * GATE: strict unit-capture with one measured exclusion, three replayed sessions at every
 *   dispatch, an exhaustive two-byte sweep, and a whole-run diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the scratch window.
 *   2. NOT VACUOUS — a no-op FAILS that same masked diff on a real cell.
 *   3. EXCLUDED — a BOUND, not a measurement: no register outside the declared set moves anywhere
 *      in the sweep. A rewrite that moves fewer of them still passes; one that moves another does
 *      not. The index registers are separately asserted to be held.
 *   4. UNIFORM CORPUS — which eras and counts real play presents, measured. The sweep is what
 *      covers the rest.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. EXHAUSTIVE — eight eras x 256 counts, poked identically on both sides.
 *   7. BAR LENGTH — where the run ENDS is re-derived from memory for all 256 counts, by planting a
 *      sentinel at the cell the count predicts and at the one past it and reading both back.
 *   8. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame.
 *   9. TEETH — nine twins, each with an exact catch count over the sweep and per session, and a
 *      whole-run verdict. Three are invisible to the whole-run arm: the run it uses stays in the
 *      first era, where a wrong row stride selects the same row, and never presents a count high
 *      enough to overrun the bar. The crafted sweep is what holds those three.
 *
 * HOLE: the crafted arms never vary the CELLS the run writes into, only the two inputs; a session
 * that arrived with a different prior pattern under the bar is not represented.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0809.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { drawKillMeter } from "../drawKillMeter.js";
import { loc_0809 as oracle } from "../../translated/loc_0809.js";
import { ERA_INDEX, KILLS_REMAINING } from "../names.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0809;

const ROWS = 0x087c;
const ROW_BYTES = 10;
const BAR_START_CELL = 0xa79f;
const CELL_STEP = -32;
const KILLS_PER_CELL = 4;
const LONGEST_BAR = 31;
const BLANK_GLYPH = 241;

/** Measured: the oracle's own call brackets. */
const SCRATCH_BYTES = 2;

const MOVED = ["f", "b", "c", "d", "e", "h", "l", "sp", "a_", "f_"];
const HELD = ["ix", "iy"];

const ERAS = [0, 1, 2, 3, 4, 5, 6, 7];
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

const sharedMachine = (overrides) => makeMachine(overrides);
const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });

const SESSIONS = [
  ["shared", sharedMachine],
  ["attract", attractMachine],
  ["turning", turningMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured. */
const DISPATCHES = { shared: 601, attract: 880, turning: 825 };

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    sharedMachine,
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
  if (entry === null) gate(drawKillMeter);
  return entry;
}

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

function craft(era, owed) {
  const m = entryState().clone();
  m.mem8[ERA_INDEX] = era;
  m.mem8[KILLS_REMAINING] = owed;
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const era of ERAS) for (const owed of everyByte) out.push([era, owed]);
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const eras = new Set();
  const counts = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      eras.add(mm.mem8[ERA_INDEX]);
      counts.add(mm.mem8[KILLS_REMAINING]);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, eras, counts };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, drawKillMeter) }));
  return sessionCache;
}

// ── the whole-run diff ──────────────────────────────────────────────────────────────────

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

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = sharedMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = sharedMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
    if (host.stoppedBy) threw = String(host.stoppedBy).slice(0, 70);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

/** Over a whole run the entry fires at more than one stack depth; the set is MEASURED. */
const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [0xafe2, 0xafe3];

// ── the twins ───────────────────────────────────────────────────────────────────────────

function rowOf(m, era) {
  return ROWS + ((ROW_BYTES * era) & 0xff);
}

/** The correct paint, so a twin below breaks one decision rather than everything. */
function paint(m, cells, glyphs, endGlyph) {
  let cursor = BAR_START_CELL;
  for (let i = 0; i < cells; i++) {
    m.mem8[cursor] = glyphs[i % 2];
    cursor = (cursor + CELL_STEP) & 0xffff;
  }
  m.mem8[cursor] = endGlyph;
  cursor = (cursor + CELL_STEP) & 0xffff;
  m.mem8[cursor] = BLANK_GLYPH;
}

function parts(m) {
  const era = m.mem8[ERA_INDEX];
  const owed = m.mem8[KILLS_REMAINING];
  const row = rowOf(m, era);
  return {
    owed,
    glyphs: [m.mem8[row], m.mem8[(row + 1) & 0xffff]],
    endGlyph: m.mem8[(row + 2 + (owed & 7)) & 0xffff],
    cells: Math.floor(owed / KILLS_PER_CELL) & LONGEST_BAR,
  };
}

function brokenNoOp() {}

/** BUG: the row stride is nine, so every era but the first reads the wrong row. */
function brokenWrongStride(m) {
  const era = m.mem8[ERA_INDEX];
  const owed = m.mem8[KILLS_REMAINING];
  const row = ROWS + ((9 * era) & 0xff);
  paint(
    m,
    Math.floor(owed / KILLS_PER_CELL) & LONGEST_BAR,
    [m.mem8[row], m.mem8[(row + 1) & 0xffff]],
    m.mem8[(row + 2 + (owed & 7)) & 0xffff],
  );
}

/** BUG: the count is divided by two, so the bar is twice as long. */
function brokenHalfDivisor(m) {
  const p = parts(m);
  paint(m, Math.floor(p.owed / 2) & LONGEST_BAR, p.glyphs, p.endGlyph);
}

/** BUG: the length is not masked to five bits, so a long bar runs past its end. */
function brokenNoLengthMask(m) {
  const p = parts(m);
  paint(m, Math.floor(p.owed / KILLS_PER_CELL), p.glyphs, p.endGlyph);
}

/** BUG: the two bar glyphs do not alternate. */
function brokenNoAlternation(m) {
  const p = parts(m);
  paint(m, p.cells, [p.glyphs[0], p.glyphs[0]], p.endGlyph);
}

/** BUG: the alternation starts on the second glyph. */
function brokenAlternationPhase(m) {
  const p = parts(m);
  paint(m, p.cells, [p.glyphs[1], p.glyphs[0]], p.endGlyph);
}

/** BUG: the end glyph is selected by the wrong three bits of the count. */
function brokenWrongEndGlyph(m) {
  const p = parts(m);
  const row = rowOf(m, m.mem8[ERA_INDEX]);
  paint(m, p.cells, p.glyphs, m.mem8[(row + 2 + ((p.owed >> 3) & 7)) & 0xffff]);
}

/** BUG: the cell past the end glyph is never blanked, so the old bar's tail survives. */
function brokenNoTailBlank(m) {
  const p = parts(m);
  let cursor = BAR_START_CELL;
  for (let i = 0; i < p.cells; i++) {
    m.mem8[cursor] = p.glyphs[i % 2];
    cursor = (cursor + CELL_STEP) & 0xffff;
  }
  m.mem8[cursor] = p.endGlyph;
}

/** BUG: the run is laid the other way along the line. */
function brokenStepsForward(m) {
  const p = parts(m);
  let cursor = BAR_START_CELL;
  for (let i = 0; i < p.cells; i++) {
    m.mem8[cursor] = p.glyphs[i % 2];
    cursor = (cursor - CELL_STEP) & 0xffff;
  }
  m.mem8[cursor] = p.endGlyph;
  cursor = (cursor - CELL_STEP) & 0xffff;
  m.mem8[cursor] = BLANK_GLYPH;
}

const TWINS = [
  ["no-op", brokenNoOp, 2038, [5, 21, 3], true],
  ["wrong-row-stride", brokenWrongStride, 1792, [0, 880, 0], false],
  ["half-divisor", brokenHalfDivisor, 1984, [601, 880, 825], true],
  ["no-length-mask", brokenNoLengthMask, 1024, [0, 0, 0], false],
  ["no-alternation", brokenNoAlternation, 1920, [601, 880, 825], true],
  ["alternation-phase", brokenAlternationPhase, 1984, [601, 880, 825], true],
  ["wrong-end-glyph", brokenWrongEndGlyph, 1752, [368, 719, 825], true],
  ["no-tail-blank", brokenNoTailBlank, 768, [0, 0, 0], false],
  ["steps-forward", brokenStepsForward, 1974, [601, 880, 825], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(drawKillMeter);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  drawKillMeter(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: entry era ${e.mem8[ERA_INDEX]} count ${e.mem8[KILLS_REMAINING]} sp ${hex4(sp)}; ` +
      `${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const caught = cross().filter(([e, n]) => (unitDiff(brokenNoOp, craft(e, n))?.addr ?? null) !== null);
  console.log(`  NOT VACUOUS: the empty candidate is caught on a cell in ${caught.length} of ${cross().length}`);
  assert.ok(caught.length > 0, "no crafted entry catches a candidate that does nothing, so RAM is " +
    "not this gate and the whole file must be re-derived");
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole sweep", { skip }, () => {
  const movedSomewhere = new Set();
  for (const [era, owed] of cross()) {
    const a = craft(era, owed);
    const b = a.clone();
    oracle(a);
    drawKillMeter(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) movedSomewhere.add(k);
  }
  const moved = REG_FIELDS.filter((k) => movedSomewhere.has(k));
  const unexpected = moved.filter((k) => !MOVED.includes(k));
  console.log(`  EXCLUDED (measured): ${moved.join(", ")}`);
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  for (const k of HELD) assert.ok(!movedSomewhere.has(k), `an index register moved (${k})`);
});

test("UNIFORM CORPUS: which eras and counts real play presents", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / eras [${[...s.eras].join(",")}] / ${s.counts.size} counts`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const eras = new Set(seen.flatMap((s) => [...s.eras]));
  assert.ok(eras.size < ERAS.length, "the corpus now covers every era the sweep does, so the " +
    "sweep is no longer what covers a row index past the end of the table");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("EXHAUSTIVE: eight eras x 256 counts are identical", { skip }, () => {
  for (const [era, owed] of cross()) {
    const d = unitDiff(drawKillMeter, craft(era, owed));
    assert.equal(d, null, `era ${era} count ${owed}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} era x count comparisons identical`);
});

test("BAR LENGTH: the run ends exactly where the count says, read back from memory", { skip }, () => {
  const SENTINEL = 0x77;
  let checked = 0;
  for (const owed of everyByte) {
    const cells = Math.floor(owed / KILLS_PER_CELL) & LONGEST_BAR;
    const endCell = (BAR_START_CELL + CELL_STEP * cells) & 0xffff;
    const blankCell = (endCell + CELL_STEP) & 0xffff;
    const beyond = (blankCell + CELL_STEP) & 0xffff;
    const m = craft(0, owed);
    m.mem8[blankCell] = SENTINEL;
    m.mem8[beyond] = SENTINEL;
    oracle(m);
    assert.equal(m.mem8[blankCell], BLANK_GLYPH, `count ${owed}: the run does not end at ${hex4(blankCell)}`);
    assert.equal(m.mem8[beyond], SENTINEL, `count ${owed}: the run ran past ${hex4(blankCell)}`);
    checked++;
  }
  console.log(`  BAR LENGTH: ${checked} counts end exactly one cell past their end glyph`);
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(drawKillMeter);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, cells [${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run stopped: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer measured");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([e, n]) => unitDiff(twin, craft(e, n)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted sweep missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, twin));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || r.cells.some((c) => !WHOLE_RUN_CELLS.includes(c));
    console.log(`  TEETH/${label}: whole machine ${seen ? `catches it (${r.threw ?? r.cells.length + " cells"})` : "is BLIND"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
