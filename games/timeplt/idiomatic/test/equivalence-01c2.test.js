// SPDX-License-Identifier: GPL-3.0-only
/**
 * blankNextLine — memory-equivalent to the frozen oracle at ROM 0x01C2.
 *
 * WHAT IT IS. Thirty-two cells blanked along one line in both planes, then a cursor cell advanced
 * by one and a counter cell taken down by one. It calls nothing.
 *
 * ★ THE ZERO FLAG IS A LIVE-OUT, AND THAT IS NOT A JUDGEMENT CALL. Both callers of this address
 *   follow the call with a conditional return on the zero flag the counter's decrement leaves. The
 *   rewrite RETURNS that flag as a boolean (counter reached zero) and its idiomatic callers branch on
 *   the return, so every arm here compares the RETURN against the oracle's Z bit alongside RAM. The
 *   counter-flag twin is the tooth: it writes the same memory and only gets the flag wrong. Where the
 *   rewrite is hosted inside the frozen game (WHOLE-MACHINE), the host shim hands the return to the
 *   frozen caller as its Z bit — the only register the oracle's callers read, measured below.
 *
 * ★ EVERYTHING ELSE THE ORACLE LEAVES IN REGISTERS IS DEAD. It leaves the walked pointer and then
 *   the counter's address in HL, the spent loop count in B, the cell step in DE, and the rest of the
 *   flag byte; the rewrite writes none of them. DEAD AT EXIT (assertDeadAtExit) asks the ORACLE:
 *   those complemented as the frozen routine hands back (Z spared), on every dispatch of an attract
 *   and a coin-start session, move no cell of any frame; Z alone flipped at the same exit, and SP
 *   moved there, are heard in every session.
 *
 * ★ THE CURSOR IS RE-READ AFTER THE BLANKING RUN, NOT CARRIED. If the run were ever aimed at the
 *   cursor cell itself, the value advanced would be the one the run just wrote. That is behaviour,
 *   and the crafted arms include a cursor aimed at the cursor cell so the re-read is exercised
 *   rather than assumed; a twin that carries the walked pointer instead is caught only there.
 *
 * GATE: strict unit-capture, three replayed sessions at every dispatch, a crafted cross over the
 *   cursor and the counter, and a whole-run masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical, and the zero flag identical.
 *   2. NOT VACUOUS — a no-op FAILS that same diff on a real cell.
 *   3. EXCLUDED — the registers that move over the whole cross, pinned exactly: one outside the
 *      set fails, and so does one that stops moving (no padding); the zero flag is checked as a
 *      live-out, the return against the oracle's Z, rather than excluded with the rest of F.
 *   3a. DEAD AT EXIT — described above.
 *   4. UNIFORM CORPUS — the cursors and counter values real play presents, and how often the
 *      counter reaches zero. That last number is what says whether the flag is exercised at all.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. CRAFTED CROSS — cursors including one aimed at the cursor cell itself and one on the colour
 *      side, crossed with counter values including zero and one.
 *   7. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame; nothing is
 *      excluded, because this routine touches no stack. The host shim sets the frozen caller's Z
 *      bit from the return and nothing else.
 *   8. TEETH — ten twins, each with an exact catch count over the cross and per session. Two are
 *      caught by NO real dispatch and by no whole run — the run this entry blanks is already blank
 *      at its far end on every real dispatch — so the crafted cross is what holds them.
 *
 * HOLE: the crafted cursors are a handful rather than a sweep, and the run length is fixed by the
 * routine, so no arm here varies it.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-01c2.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { blankNextLine } from "../blankNextLine.js";
import { loc_01c2 as oracle } from "../../translated/loc_01c2.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS, F_Z } from "../../../../core/cpu/z80.js";
import { BLANK_LINES_LEFT, BLANK_LINE_CURSOR } from "../names.js";
import { assertDeadAtExit, heard, heardAs } from "./_deadAtExit.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x01c2;

const CELLS_PER_LINE = 32;
const CELL_STEP = 32;
const BLANK_GLYPH = 241;
const LINE_COLOUR = 16;
const CHARACTER_PLANE_BIT = 0x0400;

/** The registers left different over the cross: the rest of the flag byte, the spent loop count,
 * the cell step, the counter's address, and the stack the frozen ret pops. DEAD AT EXIT measures
 * each unread by the oracle's callers. */
const MOVED = ["f", "b", "d", "e", "h", "l", "sp"];
const HELD = ["ix", "iy"];
/** The oracle's registers the rewrite does not write, poisoned at the exit (Z spared). */
const DEAD = ["b", "d", "e", "h", "l", "f"];

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
const DISPATCHES = { shared: 59, attract: 32, turning: 59 };

// ── the entry, and the comparison ───────────────────────────────────────────────────────

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
  if (entry === null) gate(blankNextLine);
  return entry;
}

/** The oracle's zero flag as the boolean the rewrite returns. */
const zOf = (m) => (m.regs.f & F_Z) !== 0;

/** Oracle vs candidate on clones: RAM, then the RETURN against the zero flag the callers branch on. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  const returned = candidate(b);
  const ram = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  if (ram) return ram;
  if (returned !== zOf(a)) return { addr: null, a: zOf(a), b: returned };
  return null;
}

function craft(cursor, counter) {
  const m = entryState().clone();
  m.mem16[BLANK_LINE_CURSOR] = cursor;
  m.mem8[BLANK_LINES_LEFT] = counter;
  return m;
}

/**
 * The real cursor, neighbours, one on the colour side, one aimed at the cursor cell itself so the
 * blanking run overwrites the pointer this routine re-reads, and two at plane edges.
 */
function cursorChoices() {
  const real = entryState().mem16[BLANK_LINE_CURSOR];
  return [real, real + 1, real - 1, real & ~CHARACTER_PLANE_BIT, BLANK_LINE_CURSOR, 0xa400, 0xa7e0];
}
const COUNTERS = [0, 1, 2, 16, 127, 128, 254, 255];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const cursor of cursorChoices()) for (const counter of COUNTERS) out.push([cursor, counter]);
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let lastLine = 0;
  const cursors = new Set();
  const counters = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      cursors.add(mm.mem16[BLANK_LINE_CURSOR]);
      counters.add(mm.mem8[BLANK_LINES_LEFT]);
      if (mm.mem8[BLANK_LINES_LEFT] === 1) lastLine++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, lastLine, cursors, counters };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, blankNextLine) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    const zero = candidate(mm);
    // The frozen caller branches on Z; hand it the returned flag there and touch nothing else.
    mm.regs.f = (mm.regs.f & ~F_Z) | (zero === true ? F_Z : 0);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

/**
 * A whole session with the candidate wired, diffed frame by frame against an all-oracle run. It is
 * written out rather than delegated because a broken twin can derail the game into an unregistered
 * transfer, and a run that DIES is a catch, not an error in the harness.
 */
let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = sharedMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o), stopped: base.stoppedBy };
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

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** The correct blanking run, so a twin below breaks one thing rather than everything. */
function blankRun(m, cells) {
  let cursor = m.mem16[BLANK_LINE_CURSOR];
  for (let i = 0; i < cells; i++) {
    m.mem8[cursor] = BLANK_GLYPH;
    m.mem8[cursor & ~CHARACTER_PLANE_BIT] = LINE_COLOUR;
    cursor = ((cursor | CHARACTER_PLANE_BIT) + CELL_STEP) & 0xffff;
  }
  return cursor;
}

function finish(m) {
  m.mem16[BLANK_LINE_CURSOR] = (m.mem16[BLANK_LINE_CURSOR] + 1) & 0xffff;
  const left = (m.mem8[BLANK_LINES_LEFT] - 1) & 0xff;
  m.mem8[BLANK_LINES_LEFT] = left;
  return left === 0;
}

function brokenNoOp() {}

/** BUG: one cell short, so the far end of the line is never blanked. */
function brokenOneCellShort(m) {
  blankRun(m, CELLS_PER_LINE - 1);
  return finish(m);
}

/** BUG: one cell too many. */
function brokenOneCellLong(m) {
  blankRun(m, CELLS_PER_LINE + 1);
  return finish(m);
}

/** BUG: the colour plane is left alone, so old colours show under the blanks. */
function brokenNoColour(m) {
  let cursor = m.mem16[BLANK_LINE_CURSOR];
  for (let i = 0; i < CELLS_PER_LINE; i++) {
    m.mem8[cursor] = BLANK_GLYPH;
    cursor = ((cursor | CHARACTER_PLANE_BIT) + CELL_STEP) & 0xffff;
  }
  return finish(m);
}

/** BUG: the cursor cell is left where it was, so the next call blanks the same line. */
function brokenCursorNotAdvanced(m) {
  blankRun(m, CELLS_PER_LINE);
  const left = (m.mem8[BLANK_LINES_LEFT] - 1) & 0xff;
  m.mem8[BLANK_LINES_LEFT] = left;
  return left === 0;
}

/** BUG: the WALKED pointer is stored back instead of the re-read one advanced by one. */
function brokenCarriesWalkedPointer(m) {
  const walked = blankRun(m, CELLS_PER_LINE);
  m.mem16[BLANK_LINE_CURSOR] = (walked + 1) & 0xffff;
  const left = (m.mem8[BLANK_LINES_LEFT] - 1) & 0xff;
  m.mem8[BLANK_LINES_LEFT] = left;
  return left === 0;
}

/** BUG: the counter is left standing, so the caller never sees the run end. */
function brokenCounterHeld(m) {
  blankRun(m, CELLS_PER_LINE);
  m.mem16[BLANK_LINE_CURSOR] = (m.mem16[BLANK_LINE_CURSOR] + 1) & 0xffff;
  return ((m.mem8[BLANK_LINES_LEFT] - 1) & 0xff) === 0;
}

/** BUG: the same memory, but the flag is taken from the CURSOR rather than the counter. */
function brokenFlagFromCursor(m) {
  blankRun(m, CELLS_PER_LINE);
  const advanced = (m.mem16[BLANK_LINE_CURSOR] + 1) & 0xffff;
  m.mem16[BLANK_LINE_CURSOR] = advanced;
  m.mem8[BLANK_LINES_LEFT] = (m.mem8[BLANK_LINES_LEFT] - 1) & 0xff;
  return (((advanced & 0xff) - 1) & 0xff) === 0;
}

/** BUG: the wrong blanking code. */
function brokenWrongGlyph(m) {
  let cursor = m.mem16[BLANK_LINE_CURSOR];
  for (let i = 0; i < CELLS_PER_LINE; i++) {
    m.mem8[cursor] = BLANK_GLYPH + 1;
    m.mem8[cursor & ~CHARACTER_PLANE_BIT] = LINE_COLOUR;
    cursor = ((cursor | CHARACTER_PLANE_BIT) + CELL_STEP) & 0xffff;
  }
  return finish(m);
}

/** BUG: the run steps the other way along the line. */
function brokenStepsBackwards(m) {
  let cursor = m.mem16[BLANK_LINE_CURSOR];
  for (let i = 0; i < CELLS_PER_LINE; i++) {
    m.mem8[cursor] = BLANK_GLYPH;
    m.mem8[cursor & ~CHARACTER_PLANE_BIT] = LINE_COLOUR;
    cursor = ((cursor | CHARACTER_PLANE_BIT) - CELL_STEP) & 0xffff;
  }
  return finish(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 56, [59, 32, 59], true],
  ["one-cell-short", brokenOneCellShort, 16, [0, 0, 0], false],
  ["one-cell-long", brokenOneCellLong, 48, [59, 32, 59], true],
  ["no-colour", brokenNoColour, 32, [6, 0, 6], true],
  ["cursor-not-advanced", brokenCursorNotAdvanced, 56, [59, 32, 59], true],
  ["carries-walked-pointer", brokenCarriesWalkedPointer, 56, [59, 32, 59], true],
  ["counter-held", brokenCounterHeld, 56, [59, 32, 59], true],
  ["flag-from-cursor", brokenFlagFromCursor, 25, [3, 2, 3], true],
  ["wrong-glyph", brokenWrongGlyph, 56, [59, 32, 59], true],
  ["steps-backwards", brokenStepsBackwards, 24, [0, 0, 0], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: RAM and the zero flag identical", { skip }, () => {
  const r = gate(blankNextLine);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  const e = entryState();
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  const returned = blankNextLine(b);
  console.log(
    `  EQUAL: entry cursor ${hex4(e.mem16[BLANK_LINE_CURSOR])} counter ${e.mem8[BLANK_LINES_LEFT]}; ` +
      `oracle zero flag ${zOf(a)}, returned ${returned}`,
  );
  assert.equal(typeof returned, "boolean", "the rewrite returns the zero flag as a boolean");
  assert.equal(returned, zOf(a), "the returned flag against the zero flag the callers branch on");
});

test("NOT VACUOUS: a no-op candidate FAILS the RAM diff at the real dispatch", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on the flag alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const [cursor, counter] of cross()) {
    const a = craft(cursor, counter);
    const b = a.clone();
    oracle(a);
    const returned = blankNextLine(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    assert.equal(returned, zOf(a), `the returned zero flag at cursor ${hex4(cursor)} counter ${counter}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(
    REG_FIELDS.filter((k) => moved.has(k)),
    MOVED,
    "the registers left different moved: none may join the set, and none may sit in it unmoved",
  );
  for (const k of HELD) assert.ok(!moved.has(k), `an index register moved (${k})`);
});

test("DEAD AT EXIT: what the oracle leaves in HL, B, DE and F-but-Z is read by nothing", { skip }, () => {
  const exits = assertDeadAtExit({
    at: TARGET, poison: DEAD, flip: { f: 0xff ^ F_Z }, frames: CORPUS_FRAMES, reachEvery: true,
    sessions: [{ label: "attract", tape: [] }, { label: "coin-start" }],
    // CONTROL, same instrument and exit: Z alone flipped — the live-out — must be heard.
    controls: [{ label: "live Z", poison: ["f"], flip: { f: F_Z }, every: true, reachEvery: true }],
  });
  // EXIT CONTROL: SP moved where this hands back; the ROM returns through it, so every session hears it.
  for (const r of exits) {
    assert.ok(heard(r.exitControl),
      `${r.label}: the exit control was not heard, so the exit poison never lands`);
  }
  console.log(`  DEAD AT EXIT: ${DEAD.join(", ")} complemented (Z spared); Z and exit controls heard ` +
    `in every session (${exits.map((r) => `${r.label} ${heardAs(r.exitControl)}`).join("; ")})`);
});

test("UNIFORM CORPUS: what real play presents, and whether the flag is exercised", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.cursors.size} cursors / ${s.counters.size} counters / ` +
      `${s.lastLine} on the last line`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const lastLine = seen.reduce((n, s) => n + s.lastLine, 0);
  assert.ok(lastLine > 0, "no real dispatch takes the counter to zero, so the zero flag is never " +
    "set on real data and only the crafted cross exercises it");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, RAM and the flag identical on each`);
});

test("CRAFTED: every cursor x counter combination is identical", { skip }, () => {
  for (const [cursor, counter] of cross()) {
    const d = unitDiff(blankNextLine, craft(cursor, counter));
    assert.equal(d, null, `cursor ${hex4(cursor)} counter ${counter}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("WHOLE-MACHINE: a driven session is byte-identical with the rewrite wired", { skip }, () => {
  const r = wholeRunCells(blankNextLine);
  console.log(`  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, ${r.cells.length} cells differ`);
  assert.equal(r.threw, null, `the run stopped: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, [], "this routine touches no stack, so a whole run must be identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([u, n]) => unitDiff(twin, craft(u, n)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
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
    const seen = r.threw !== null || r.cells.length > 0;
    console.log(`  TEETH/${label}: whole machine ${seen ? `catches it (${r.threw ?? r.cells.length + " cells"})` : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
