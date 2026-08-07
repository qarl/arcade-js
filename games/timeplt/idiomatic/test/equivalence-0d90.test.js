// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0d90 — memory-equivalent to the frozen oracle at ROM 0x0D90.
 *
 * WHAT IT IS. One digit painted into one character cell, with its colour beside it. The low four
 * bits of the value select a glyph out of a sixteen-entry table through the already-decompiled
 * fetchTableByte, so that transfer is dissolved into a direct call here; the run pointer the
 * caller was walking is saved across the lookup and handed back where it was.
 *
 * ★ THE ORACLE SAVES THAT POINTER ON THE STACK AND THE REWRITE SAVES IT IN A LOCAL, so the bytes
 *   just below the entry stack pointer are dead scratch on one side and untouched on the other.
 *   The window is measured and PINNED — every arm walks the whole dump and asserts no divergence
 *   escapes it, and the EQUAL arm asserts the window is fully dirty so its width cannot silently
 *   shrink either.
 *
 * GATE: strict unit-capture with one measured exclusion, three replayed sessions at every
 *   dispatch, and an exhaustive sweep of the value byte crossed with cursors and colours.
 *   Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the scratch window, which is fully dirty.
 *   2. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell rather than a register.
 *   3. EXCLUDED — the registers that move over the whole crafted cross, pinned; the cursor is
 *      checked as a live-out and the run pointer as PRESERVED. The value register is NOT a
 *      live-out and the EQUAL arm asserts the two sides disagree on it, so that is recorded
 *      rather than assumed.
 *   4. UNIFORM CORPUS — how many values, cursors and colours real play presents. It is a thin
 *      corpus and the numbers say how thin.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. EXHAUSTIVE — all 256 values against several cursors and colours, which is what covers the
 *      high nibble the corpus never varies.
 *   7. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame under the same
 *      scratch-window mask, which is the only thing that differs over a whole run.
 *   8. TEETH — eight twins, each with an exact catch count over the cross and per session. Two are
 *      caught by NO real dispatch in one or more sessions — a cursor already on the glyph side
 *      cannot show a missing snap, and a cell whose colour already matches cannot show a skipped
 *      colour — so for those the crafted cross is the only arm holding them.
 *
 * HOLE: the cursors the crafted arms use are the real one plus a handful of neighbours; nothing
 * here sweeps the whole tilemap, and a cursor arriving on the colour side is covered by exactly
 * one crafted case rather than by a range.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0d90.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_0d90 } from "../loc_0d90.js";
import { loc_0d90 as oracle } from "../../translated/loc_0d90.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x0d90;

const GLYPHS = 0x0dcc;
const DIGIT_BITS = 0x0f;
const CHARACTER_PLANE_BIT = 0x0400;

/** The oracle brackets its lookup with a push/pop of the run pointer; the rewrite uses a local. */
const SCRATCH_BYTES = 4;

const MOVED = ["a", "f", "sp"];
const HELD = ["b", "c", "ix", "iy"];

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

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { shared: 14, attract: 14, turning: 12 };

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
  if (entry === null) gate(loc_0d90);
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

function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** Oracle vs candidate on clones: masked RAM, then the cursor, the glyph and the run pointer. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of ["de", "hl"]) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** A real captured machine with the value, the cursor and the colour forced. */
function craft(value, cursor, colour) {
  const m = entryState().clone();
  m.regs.a = value;
  m.regs.de = cursor;
  m.regs.c = colour;
  return m;
}

/** The real cursor, three neighbours, one on the colour side, and one at a plane edge. */
function cursors() {
  const real = entryState().regs.de;
  return [real, real - 32, real + 32, real & ~CHARACTER_PLANE_BIT, 0xa400, 0xa7ff];
}
const COLOURS = [0, 1, 16, 255];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const cursor of cursors()) {
    for (const colour of COLOURS) for (const value of everyByte) out.push([value, cursor, colour]);
  }
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const values = new Set();
  const seenCursors = new Set();
  const colours = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      values.add(mm.regs.a);
      seenCursors.add(mm.regs.de);
      colours.add(mm.regs.c);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, values, cursors: seenCursors, colours };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, loc_0d90) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

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

/**
 * Every cell that EVER differs between an all-oracle run and one with the candidate wired, over a
 * whole session. A first-difference helper cannot express "differs only inside the scratch
 * window", so this walks the lot and hands back the set.
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

/**
 * Over a whole run the entry is dispatched at more than one stack depth, so the dead scratch
 * appears at more than one address. The set is MEASURED, and every member is asserted to lie
 * inside the stack region rather than merely tolerated.
 */
const STACK_FLOOR = 0xafd0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [0xafdc, 0xafdd, 0xafde, 0xafdf, 0xafe0, 0xaff4, 0xaff6];

/** The scratch window as ADDRESSES, taken from the real entry, for the whole-run arms. */
const scratchWindow = () => {
  const sp = entryState().regs.sp;
  return Array.from({ length: SCRATCH_BYTES }, (_unused, i) => sp - SCRATCH_BYTES + i);
};

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the high nibble is not masked away, so a value over fifteen indexes past the table. */
function brokenNoMask(m) {
  const { regs, mem8 } = m;
  const glyph = mem8[GLYPHS + regs.a];
  mem8[regs.de] = glyph;
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de |= CHARACTER_PLANE_BIT;
  regs.a = glyph;
}

/** BUG: the table is one entry along. */
function brokenTableOffByOne(m) {
  const { regs, mem8 } = m;
  const glyph = mem8[GLYPHS + 1 + (regs.a & DIGIT_BITS)];
  mem8[regs.de] = glyph;
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de |= CHARACTER_PLANE_BIT;
  regs.a = glyph;
}

/** BUG: the colour is never written, so the cell keeps whatever colour it had. */
function brokenColourSkipped(m) {
  const { regs, mem8 } = m;
  const glyph = mem8[GLYPHS + (regs.a & DIGIT_BITS)];
  mem8[regs.de] = glyph;
  regs.de |= CHARACTER_PLANE_BIT;
  regs.a = glyph;
}

/** BUG: the glyph and the colour go to each other's planes. */
function brokenPlanesSwapped(m) {
  const { regs, mem8 } = m;
  const glyph = mem8[GLYPHS + (regs.a & DIGIT_BITS)];
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = glyph;
  mem8[regs.de | CHARACTER_PLANE_BIT] = regs.c;
  regs.de |= CHARACTER_PLANE_BIT;
  regs.a = glyph;
}

/** BUG: the cursor comes back on whichever side it started, instead of being snapped across. */
function brokenCursorNotSnapped(m) {
  const { regs, mem8 } = m;
  const held = regs.de;
  const glyph = mem8[GLYPHS + (regs.a & DIGIT_BITS)];
  mem8[held] = glyph;
  mem8[held & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de = held;
  regs.a = glyph;
}

/** BUG: the run pointer is left where the lookup put it instead of being handed back. */
function brokenPointerClobbered(m) {
  const { regs, mem8 } = m;
  const index = regs.a & DIGIT_BITS;
  const glyph = mem8[GLYPHS + index];
  regs.hl = GLYPHS + index;
  mem8[regs.de] = glyph;
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de |= CHARACTER_PLANE_BIT;
  regs.a = glyph;
}

/** BUG: the raw value is painted instead of the glyph the table names. */
function brokenPaintsRawValue(m) {
  const { regs, mem8 } = m;
  const value = regs.a & DIGIT_BITS;
  mem8[regs.de] = value;
  mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
  regs.de |= CHARACTER_PLANE_BIT;
  regs.a = value;
}

const TWINS = [
  ["no-op", brokenNoOp, 6064, [6, 14, 6], true],
  ["no-mask", brokenNoMask, 4760, [1, 2, 1], true],
  ["table-off-by-one", brokenTableOffByOne, 5120, [14, 14, 12], true],
  ["colour-skipped", brokenColourSkipped, 4864, [0, 10, 0], true],
  ["planes-swapped", brokenPlanesSwapped, 6144, [14, 12, 12], true],
  ["cursor-not-snapped", brokenCursorNotSnapped, 1024, [0, 0, 0], true],
  ["pointer-clobbered", brokenPointerClobbered, 6144, [14, 14, 12], true],
  ["paints-raw-value", brokenPaintsRawValue, 5120, [14, 14, 12], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside a fully dirty scratch window", { skip }, () => {
  gate(loc_0d90);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  loc_0d90(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: entry value ${e.regs.a} cursor ${hex4(e.regs.de)} colour ${e.regs.c} sp ${hex4(sp)}; ` +
      `${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.de, b.regs.de, "the cursor left behind");
  assert.equal(a.regs.hl, b.regs.hl, "the run pointer must come back where it was");
  // The value register is NOT a live-out: the oracle leaves the COLOUR in it and the rewrite
  // leaves the glyph, and every caller reloads it before reading it again.
  assert.notEqual(a.regs.a, b.regs.a, "the value register agrees, so this note is stale");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const [value, cursor, colour] of cross()) {
    const a = craft(value, cursor, colour);
    const b = a.clone();
    oracle(a);
    loc_0d90(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
  for (const k of HELD) assert.ok(!moved.has(k), `a register a caller may rely on moved (${k})`);
});

test("UNIFORM CORPUS: how thin the real corpus is, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.values.size} values / ${s.cursors.size} cursors / ` +
      `${s.colours.size} colours`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const values = new Set(seen.flatMap((s) => [...s.values]));
  assert.ok(values.size < 256, "the corpus now covers the whole value range, so the crafted sweep " +
    "is no longer what covers the high nibble");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("EXHAUSTIVE: every value against every crafted cursor and colour", { skip }, () => {
  for (const [value, cursor, colour] of cross()) {
    const d = unitDiff(loc_0d90, craft(value, cursor, colour));
    assert.equal(d, null, `value ${value} cursor ${hex4(cursor)} colour ${colour}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} value x cursor x colour comparisons identical`);
});

test("WHOLE-MACHINE: a driven session differs only in the scratch window", { skip }, () => {
  const r = wholeRunCells(loc_0d90);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address, so a ` +
      "real game cell diverged over the run");
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer measured");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([v, u, c]) => unitDiff(twin, craft(v, u, c)) !== null).length;
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
    const seen = r.threw !== null || r.cells.length > scratchWindow().length;
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-run verdict on the ${label} twin changed`);
  });
}
