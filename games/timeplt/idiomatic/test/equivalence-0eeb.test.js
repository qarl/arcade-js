// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintDigitDroppingLeadingZero — memory-equivalent to the frozen oracle at ROM 0x0EEB.
 *
 * WHAT IT IS. One digit painted into the character plane with its colour, or suppressed. Two of
 * the transfers it makes are restarts into routines that are ALREADY decompiled — the table fetch
 * and the cursor retreat — so the rewrite calls both directly and dissolving them belongs here.
 *
 * GATE: strict unit-capture with a stack-scratch exclusion, a replayed real session, an EXHAUSTIVE
 *   sweep of the entry's whole input space, and a whole-machine replay. Holes stated:
 *
 *   1. EQUAL at the real dispatches — RAM identical outside the scratch window, and both live-outs
 *      (the suppression allowance and the cursor) identical too.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, exactly [SP-4, SP): the oracle brackets the
 *      table fetch with a push/pop of the run pointer and pays a nested return; the rewrite models
 *      no stack. The corpus arm asserts the exact set of offsets ever dirtied, so it cannot widen.
 *   3. EXCLUDED, DELIBERATELY — the register file may differ only within {a, f, sp}, and pc. The
 *      accumulator is dead: the one caller reloads it before each of its two calls.
 *   4. THE CORPUS IS TINY AND THIS ARM SAYS SO — the shared tape dispatches this entry twice, both
 *      in one frame, and the arm asserts that exactly one of the two suppresses. So both branches
 *      ARE real, but two samples is all the corpus is; the exhaustive sweep carries the weight.
 *   5. EXHAUSTIVE — every value 0..255 against four allowances, which is the entry's ENTIRE input
 *      space apart from the cursor and the colour, both of which are taken from a real entry.
 *   6. WHOLE-MACHINE — the whole session with the rewrite wired through the omitted-return seam;
 *      only the dead bytes under the stack pointer may differ. This is what holds the claim that
 *      the accumulator is dead, which no unit arm can see.
 *   7. TEETH — seven twins, each with its exact catch counts declared.
 *
 * HOLE: two dispatches is one sample per branch, so a twin can be caught on the corpus by accident
 * of which branch each took. Two of the seven are caught by NO real dispatch and one by only one
 * of the two; the per-twin counts state that rather than leaving it implied.
 * HOLE: the crafted sweep varies the value and the allowance and holds the cursor and colour at
 * the real ones, so nothing here speaks for a cursor sitting off its own plane.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0eeb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { paintDigitDroppingLeadingZero } from "../paintDigitDroppingLeadingZero.js";
import { loc_0eeb as oracle } from "../../translated/loc_0eeb.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0eeb;

const GLYPHS = 0x0f06;
const DIGIT_BITS = 0x0f;
const CHARACTER_PLANE_BIT = 0x0400;
const CELL_STEP = 32;

const SCRATCH_BYTES = 4;
const SCRATCH_OFFSETS = [-4, -3, -2, -1];
const EXCLUDED = ["a", "f", "sp"];

const CORPUS_FRAMES = 2000;
const DISPATCHES = 2;

/**
 * The dead bytes a WHOLE session leaves differing. Six, not four: the entry is reached at more
 * than one call depth, and the deepest pair belongs to the nested fetch. Measured.
 */
const SESSION_SCRATCH = [0xaff8, 0xaff9, 0xaffa, 0xaffb, 0xaffd, 0xaffe];

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

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

/** Oracle vs candidate on clones: masked RAM, then the two live-outs. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const stray = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (stray) return stray;
  if (a.regs.b !== b.regs.b) return { addr: null, a: a.regs.b, b: b.regs.b };
  if (a.regs.de !== b.regs.de) return { addr: null, a: a.regs.de, b: b.regs.de };
  return null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  let suppressions = 0;
  const dirty = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if ((mm.regs.a & DIGIT_BITS) === 0 && mm.regs.b !== 0) suppressions++;
    const sp = mm.regs.sp;
    const a = mm.clone();
    const b = mm.clone();
    oracle(a);
    candidate(b);
    for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) dirty.add(d.addr - sp);
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, suppressions, dirty };
}

let cache = null;
const session = () => (cache ??= replaySession(paintDigitDroppingLeadingZero));

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with the two things this entry reads out of registers forced. */
function craft(value, allowance) {
  const m = entryState().clone();
  m.regs.a = value;
  m.regs.b = allowance;
  return m;
}

const ALLOWANCES = [0, 1, 2, 255];
const VALUES = Array.from({ length: 256 }, (_unused, v) => v);
const SWEEP_SIZE = ALLOWANCES.length * VALUES.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (const allowance of ALLOWANCES) {
    for (const value of VALUES) if (unitDiff(candidate, craft(value, allowance))) caught++;
  }
  return caught;
}

function wholeRunCells(candidate) {
  const base = makeMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: paints every digit, so a leading zero takes a cell it should have left blank. */
function brokenNeverSuppresses(m) {
  m.regs.b = 0;
  paint(m, m.regs.a & DIGIT_BITS, m.regs.c);
}

/** BUG: suppresses every zero, so a zero after the allowance is spent is lost. */
function brokenAlwaysSuppresses(m) {
  const digit = m.regs.a & DIGIT_BITS;
  if (digit === 0) {
    m.regs.b = (m.regs.b - 1) & 0xff;
    m.regs.de = (m.regs.de + CELL_STEP) & 0xffff;
    return;
  }
  m.regs.b = 0;
  paint(m, digit, m.regs.c);
}

/** BUG: the shape table starts one byte on, so every digit paints its neighbour's shape. */
function brokenTableOffByOne(m) {
  run(m, (mm, digit) => paintAt(mm, GLYPHS + 1 + digit, mm.regs.c));
}

/** BUG: a painted digit leaves the allowance standing, so a later zero can still be suppressed. */
function brokenKeepsAllowance(m) {
  const digit = m.regs.a & DIGIT_BITS;
  if (digit === 0 && m.regs.b !== 0) {
    m.regs.b = (m.regs.b - 1) & 0xff;
    m.regs.de = (m.regs.de + CELL_STEP) & 0xffff;
    return;
  }
  paint(m, digit, m.regs.c);
}

/** BUG: suppresses without stepping back, so the blank consumes a cell after all. */
function brokenNoRetreat(m) {
  const digit = m.regs.a & DIGIT_BITS;
  if (digit === 0 && m.regs.b !== 0) {
    m.regs.b = (m.regs.b - 1) & 0xff;
    return;
  }
  m.regs.b = 0;
  paint(m, digit, m.regs.c);
}

/** BUG: the colour goes to the glyph's own cell instead of the plane beside it. */
function brokenColourToGlyphPlane(m) {
  const digit = m.regs.a & DIGIT_BITS;
  if (digit === 0 && m.regs.b !== 0) {
    m.regs.b = (m.regs.b - 1) & 0xff;
    m.regs.de = (m.regs.de + CELL_STEP) & 0xffff;
    return;
  }
  m.regs.b = 0;
  m.mem8[m.regs.de] = m.mem8[GLYPHS + digit];
  m.mem8[m.regs.de] = m.regs.c;
  m.regs.de |= CHARACTER_PLANE_BIT;
}

function run(m, painter) {
  const digit = m.regs.a & DIGIT_BITS;
  if (digit === 0 && m.regs.b !== 0) {
    m.regs.b = (m.regs.b - 1) & 0xff;
    m.regs.de = (m.regs.de + CELL_STEP) & 0xffff;
    return;
  }
  m.regs.b = 0;
  painter(m, digit);
}

function paint(m, digit, colour) {
  paintAt(m, GLYPHS + digit, colour);
}

function paintAt(m, shapeAddr, colour) {
  m.mem8[m.regs.de] = m.mem8[shapeAddr];
  m.mem8[m.regs.de & ~CHARACTER_PLANE_BIT] = colour;
  m.regs.de |= CHARACTER_PLANE_BIT;
}

const TWINS = [
  ["no-op", brokenNoOp, 1008, 2],
  ["never-suppresses", brokenNeverSuppresses, 48, 1],
  ["always-suppresses", brokenAlwaysSuppresses, 16, 0],
  ["table-off-by-one", brokenTableOffByOne, 976, 1],
  ["keeps-allowance", brokenKeepsAllowance, 720, 0],
  ["no-retreat", brokenNoRetreat, 48, 1],
  ["colour-to-glyph-plane", brokenColourToGlyphPlane, 976, 1],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: paintDigitDroppingLeadingZero == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  paintDigitDroppingLeadingZero(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.b, b.regs.b, "the suppression allowance left behind");
  assert.equal(a.regs.de, b.regs.de, "the cursor left behind");
  console.log(
    `  EQUAL: value=${entryState().regs.a} allowance=${entryState().regs.b} ` +
      `cursor=${hex4(entryState().regs.de)}; identical outside [SP-4, SP)`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers, pc and the scratch push, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  paintDigitDroppingLeadingZero(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(
    unexpected,
    [],
    "a register outside the excluded set diverged: the allowance and the cursor are live-outs",
  );
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("THE CORPUS IS TINY: two dispatches, exactly one of them suppressing", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.suppressions, 1, "the split between the two branches moved, so the per-twin real\n    catch counts below are measuring a different corpus");
  assert.deepEqual(
    [...s.dirty].sort((x, y) => x - y),
    SCRATCH_OFFSETS,
    "the session dirtied a different window under the stack pointer",
  );
  console.log(`  CORPUS SHAPE: ${s.dispatches} dispatches, ${s.suppressions} suppressing`);
});

test("CORPUS: every dispatch of the real session replays identically", { skip }, () => {
  assert.equal(session().caught, 0, "the rewrite diverged on a real dispatch");
  console.log(`  CORPUS: ${session().dispatches} real dispatches, identical on each`);
});

test("EXHAUSTIVE: every value against four allowances behaves as the oracle", { skip }, () => {
  assert.equal(sweepCaught(paintDigitDroppingLeadingZero), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} value x allowance comparisons identical`);
});

test("WHOLE-MACHINE: the session differs only in the dead stack bytes", { skip }, () => {
  const r = wholeRunCells(paintDigitDroppingLeadingZero);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the dead stack bytes");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, realCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession(twin);
    assert.equal(r.dispatches, DISPATCHES, "the session's dispatch count moved");
    assert.equal(r.caught, realCaught, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: the real session catches ${r.caught} of ${r.dispatches}`);
  });
}
