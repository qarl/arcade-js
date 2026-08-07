// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_4dcf — memory-equivalent to the frozen oracle at ROM 0x4DCF.
 *
 * WHAT IT IS. Four cells written — a caller's glyph, the blanking glyph one address below it, and
 * the caller's colour beside both — and then the cursor stepped one place along the line by the
 * already-decompiled advanceCharCursor, so that transfer is dissolved into a direct call here.
 *
 * ★ THE ORACLE BRACKETS ITS STEP WITH A RETURN ADDRESS AND THE REWRITE DOES NOT, so the bytes just
 *   below the entry stack pointer are dead scratch on one side only. The window is MEASURED and
 *   pinned: every arm walks the whole dump and asserts no divergence escapes it, and the EQUAL arm
 *   asserts how much of the window is actually dirty rather than assuming it all is.
 *
 * ★ THE PLANE SNAP IS A SET, NOT A RESTORE, so a cursor arriving on the colour side comes back on
 *   the glyph side and writes its glyph in the wrong plane on the way. That is behaviour, not a
 *   bug, and the crafted arms include such a cursor explicitly with a twin that "restores" instead.
 *
 * GATE: strict unit-capture with one measured exclusion, three replayed sessions at every
 *   dispatch, a crafted cross over cursors, glyphs and colours, and a whole-run masked diff.
 *   Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the scratch window; the cursor checked.
 *   2. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell.
 *   3. EXCLUDED — the registers that move over the whole cross, pinned; the pair the caller keeps
 *      across the loop is checked as HELD.
 *   4. UNIFORM CORPUS — how many cursors, glyphs and colours real play presents.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. CRAFTED CROSS — cursors that include one on the colour side and one at a page boundary,
 *      crossed with glyphs and colours.
 *   7. WHOLE-MACHINE — a driven session, diffed every frame, differing only in stack scratch,
 *      each differing address asserted to BE a stack address.
 *   8. TEETH — nine twins, each with an exact catch count over the cross and per session. The
 *      plane-restored twin is caught by NO real dispatch and by no whole run either, because
 *      every real cursor arrives on the glyph side; the crafted cursor on the colour side is the
 *      only thing holding it, and its verdicts record that rather than glossing it.
 *
 * HOLE: the cursors are a handful, not a sweep of the tilemap; the page-boundary case is one
 * crafted entry rather than a range.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4dcf.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_4dcf } from "../loc_4dcf.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { loc_4dcf as oracle } from "../../translated/loc_4dcf.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4dcf;

const BLANK_GLYPH = 241;
const CHARACTER_PLANE_BIT = 0x0400;
const CELL_STEP = -32;

/** Measured: the oracle's own call bracket. */
const SCRATCH_BYTES = 2;

const MOVED = ["a", "f", "sp"];
const HELD = ["b", "c", "ix", "iy"];

/** Over a whole run the entry fires at more than one stack depth; the set is MEASURED. */
const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [0xaffa];

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
const DISPATCHES = { shared: 30, attract: 0, turning: 18 };

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
  if (entry === null) gate(loc_4dcf);
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

/** Oracle vs candidate on clones: masked RAM, then the stepped cursor. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  if (a.regs.de !== b.regs.de) return { addr: null, a: a.regs.de, b: b.regs.de };
  return null;
}

function craft(cursor, glyph, colour) {
  const m = entryState().clone();
  m.regs.de = cursor;
  m.regs.b = glyph;
  m.regs.c = colour;
  return m;
}

/** The real cursor, two neighbours, one on the COLOUR side, and one on a page boundary. */
function cursors() {
  const real = entryState().regs.de;
  return [real, real - 32, real + 32, real & ~CHARACTER_PLANE_BIT, 0xa400, 0xa500, 0xa7ff];
}
const GLYPHS = [0, 1, 16, 128, BLANK_GLYPH, 255];
const COLOURS = [0, 1, 16, 255];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const cursor of cursors()) {
    for (const glyph of GLYPHS) for (const colour of COLOURS) out.push([cursor, glyph, colour]);
  }
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const seenCursors = new Set();
  const glyphs = new Set();
  const colours = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      seenCursors.add(mm.regs.de);
      glyphs.add(mm.regs.b);
      colours.add(mm.regs.c);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, cursors: seenCursors, glyphs, colours };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, loc_4dcf) }));
  return sessionCache;
}

// ── the whole-run masked diff ───────────────────────────────────────────────────────────

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
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
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
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the blanking glyph beside the piece is never laid, so the old cell shows through. */
function brokenNoBlank(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = (cursor - 1) & 0xffff;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = regs.c;
  regs.de = cursor | CHARACTER_PLANE_BIT;
  advanceCharCursor(m);
}

/** BUG: only the piece's own cell is coloured, so its blank partner keeps the old colour. */
function brokenOneColourOnly(m) {
  const { regs, mem8 } = m;
  mem8[regs.de] = regs.b;
  mem8[(regs.de - 1) & 0xffff] = BLANK_GLYPH;
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de = (regs.de & ~CHARACTER_PLANE_BIT) | CHARACTER_PLANE_BIT;
  advanceCharCursor(m);
}

/** BUG: the partner cell is taken one ABOVE instead of one below. */
function brokenPartnerAbove(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = BLANK_GLYPH;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = (cursor - 1) & 0xffff;
  mem8[cursor] = regs.c;
  regs.de = cursor | CHARACTER_PLANE_BIT;
  advanceCharCursor(m);
}

/** BUG: the cursor is not stepped, so a caller's run paints the same place forever. */
function brokenCursorHeld(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = (cursor - 1) & 0xffff;
  mem8[cursor] = BLANK_GLYPH;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = regs.c;
  regs.de = cursor | CHARACTER_PLANE_BIT;
}

/** BUG: the cursor steps the wrong way along the line. */
function brokenStepsBackwards(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = (cursor - 1) & 0xffff;
  mem8[cursor] = BLANK_GLYPH;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = regs.c;
  regs.de = ((cursor | CHARACTER_PLANE_BIT) - CELL_STEP) & 0xffff;
}

/** BUG: the plane is RESTORED rather than set, so a cursor on the colour side stays there. */
function brokenPlaneRestored(m) {
  const { regs, mem8 } = m;
  const startedOnGlyphSide = (regs.de & CHARACTER_PLANE_BIT) !== 0;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = (cursor - 1) & 0xffff;
  mem8[cursor] = BLANK_GLYPH;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = regs.c;
  regs.de = startedOnGlyphSide ? cursor | CHARACTER_PLANE_BIT : cursor;
  advanceCharCursor(m);
}

/** BUG: the glyph and the colour change places. */
function brokenGlyphAndColourSwapped(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.c;
  cursor = (cursor - 1) & 0xffff;
  mem8[cursor] = BLANK_GLYPH;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.b;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = regs.b;
  regs.de = cursor | CHARACTER_PLANE_BIT;
  advanceCharCursor(m);
}

/** BUG: the wrong blanking code, one out. */
function brokenWrongBlank(m) {
  const { regs, mem8 } = m;
  let cursor = regs.de;
  mem8[cursor] = regs.b;
  cursor = (cursor - 1) & 0xffff;
  mem8[cursor] = BLANK_GLYPH + 1;
  cursor = cursor & ~CHARACTER_PLANE_BIT;
  mem8[cursor] = regs.c;
  cursor = (cursor + 1) & 0xffff;
  mem8[cursor] = regs.c;
  regs.de = cursor | CHARACTER_PLANE_BIT;
  advanceCharCursor(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 168, [30, 0, 18], true],
  ["no-blank", brokenNoBlank, 48, [4, 0, 2], true],
  ["one-colour-only", brokenOneColourOnly, 150, [4, 0, 2], true],
  ["partner-above", brokenPartnerAbove, 167, [30, 0, 18], true],
  ["cursor-held", brokenCursorHeld, 168, [30, 0, 18], true],
  ["steps-backwards", brokenStepsBackwards, 168, [30, 0, 18], true],
  ["plane-restored", brokenPlaneRestored, 24, [0, 0, 0], false],
  ["glyph-and-colour-swapped", brokenGlyphAndColourSwapped, 140, [30, 0, 18], true],
  ["wrong-blank", brokenWrongBlank, 120, [30, 0, 18], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(loc_4dcf);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  loc_4dcf(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: entry cursor ${hex4(e.regs.de)} glyph ${e.regs.b} colour ${e.regs.c} sp ${hex4(sp)}; ` +
      `${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.de, b.regs.de, "the stepped cursor left behind");
});

test("NOT VACUOUS: a no-op candidate FAILS, though only on the cursor here", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  // THE CAPTURED ENTRY IS IDEMPOTENT ON MEMORY: the four cells already hold the glyph, the blank
  // and the colour this dispatch would write, so RAM alone sees nothing and it is the stepped
  // cursor that catches the empty candidate. The crafted cross is what catches it on cells.
  assert.equal(d.addr, null, "the no-op is now caught on a CELL at this entry, so the entry is no " +
    "longer the idempotent one this file records and the crafted cross's role has changed");
  const onCells = cross().filter(([u, g, c]) => (unitDiff(brokenNoOp, craft(u, g, c))?.addr ?? null) !== null);
  assert.ok(onCells.length > 0, "no crafted entry catches the no-op on a cell either, so RAM is " +
    "not part of this gate at all");
  console.log(
    `  NOT VACUOUS: caught on the cursor at the real entry, and on a cell in ${onCells.length} of ` +
      `${cross().length} crafted entries`,
  );
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const [cursor, glyph, colour] of cross()) {
    const a = craft(cursor, glyph, colour);
    const b = a.clone();
    oracle(a);
    loc_4dcf(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
  for (const k of HELD) assert.ok(!moved.has(k), `a register the caller's loop relies on moved (${k})`);
});

test("UNIFORM CORPUS: what real play presents at this entry", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.cursors.size} cursors / ${s.glyphs.size} glyphs / ` +
      `${s.colours.size} colours`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const total = seen.reduce((n, s) => n + s.dispatches, 0);
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("CRAFTED: every cursor x glyph x colour combination is identical", { skip }, () => {
  for (const [cursor, glyph, colour] of cross()) {
    const d = unitDiff(loc_4dcf, craft(cursor, glyph, colour));
    assert.equal(d, null, `cursor ${hex4(cursor)} glyph ${glyph} colour ${colour}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(loc_4dcf);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
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
    const caught = cross().filter(([u, g, c]) => unitDiff(twin, craft(u, g, c)) !== null).length;
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

  test(`TEETH: the whole-run masked diff sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || r.cells.some((c) => !WHOLE_RUN_CELLS.includes(c));
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-run verdict on the ${label} twin changed`);
  });
}
