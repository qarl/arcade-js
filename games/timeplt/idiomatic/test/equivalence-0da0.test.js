// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintTwoSuppressedDigitsFromByte — memory-equivalent to the frozen oracle at ROM 0x0DA0.
 *
 * WHAT IT IS. One packed byte painted as two digits with leading zeros suppressed: the high
 * nibble, a cursor step, the low nibble, another cursor step. Both the painter at ROM 0x0DAF and
 * the cursor step at ROM 0x0020 ARE ALREADY DECOMPILED, so the rewrite calls paintSuppressedDigit
 * and advanceCharCursor directly and dissolving those four transfers belongs to this caller's
 * unit.
 *
 * ★ THE DECLARED RANGE ENDS AT 0x0DAE AND THE PAINTER BEGINS AT 0x0DAF, so a rewrite worked from
 *   the range rather than from the call graph would inline a routine that already has a name. It
 *   is not inlined here, and that is CHECKED rather than asserted: CALLS, NOT RESTATES reads the
 *   module's own text for the two imports and for the absence of a constant that belongs to each
 *   helper's body, and runs the same predicate over those helpers as a positive control, so the
 *   absence is only evidence once the check is shown able to see the thing present.
 *
 * ★ THE FLAG IS A REAL LIVE-OUT AND IT IS DERIVED FROM THE ORACLE, not from the module. The
 *   shared printer that reaches this entry calls it, steps its run pointer, and CALLS IT AGAIN,
 *   so the flag, the colour, the cursor pair and the run pointer are all read by the successor
 *   while still holding what this entry left. The accumulator and the flags register are not:
 *   the successor is a 16-bit decrement, which reads neither, and the call after it reloads the
 *   accumulator from the pointer before anything looks at it.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT, so the bytes just below the entry stack pointer
 *   are dead scratch on one side only. The window is MEASURED and pinned, and every arm walks the
 *   whole dump so the exclusion cannot quietly widen.
 *
 * GATE: strict unit-capture with one measured exclusion, three replayed sessions at every
 *   dispatch, a crafted cross over the packed byte, the flag, the cursor and the colour, and a
 *   whole-run masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the scratch window.
 *   2. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell rather than a register.
 *   3. EXCLUDED — the registers that move over the whole cross, pinned by measurement; the flag
 *      is checked as a live-out and the run pointer as PRESERVED.
 *   4. UNIFORM CORPUS — how many bytes, flags, cursors and colours real play presents. Thin, and
 *      the numbers say how thin, which is why the crafted cross carries the weight.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. EXHAUSTIVE — all 256 packed bytes against several flags, cursors and colours.
 *   7. THE FLAG CARRIES — the whole point of the pair, asserted as an output and shown to be
 *      order-dependent: the two digits are not interchangeable once the flag moves.
 *   8. TWO READS — the run pointer aimed at a cell the FIRST paint overwrites, so the second
 *      digit follows the overwritten byte. Only this arm can tell one read from two.
 *   9. ACCUMULATOR IS DEAD AT THE PAINT — the accumulator and the flags register poisoned at each
 *      point the oracle returns from the painter, on every crafted entry, with nothing observable
 *      moving. This is the check on the painter's own excluded set, made from its caller.
 *  10. CALLS, NOT RESTATES — the module's text, with each helper's own body as a control.
 *  11. HANDOVER — the two digits, in order, at the cursors the steps produce.
 *  12. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame.
 *  13. TEETH — ten twins, each with an exact catch count over the cross and per session. One is
 *      caught by NO crafted entry, NO real dispatch and no whole run — reading the byte once
 *      instead of twice only shows where a paint lands on the byte itself — so the TWO READS arm
 *      is the only thing holding it, and its verdicts record that rather than glossing it.
 *
 * HOLE: the cursors are the real one plus a neighbour, one on the colour side and one plane edge;
 * nothing here sweeps the tilemap.
 * HOLE: over a whole run this rewrite leaves NO cell differing at a frame boundary, so the
 * whole-machine arm is an equality check here and only a weak discriminator between twins; the
 * per-twin verdicts record which twins it can and cannot see.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0da0.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { paintTwoSuppressedDigitsFromByte } from "../paintTwoSuppressedDigitsFromByte.js";
import { paintSuppressedDigit } from "../paintSuppressedDigit.js";
import { paintUnsuppressedDigit } from "../paintUnsuppressedDigit.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { loc_0da0 as oracle } from "../../translated/loc_0da0.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0da0;

const CHARACTER_PLANE_BIT = 0x0400;
const CELL_STEP = 32;
const HIGH_DIGIT_SHIFT = 4;
const LOW_NIBBLE = 0x0f;

/** Measured: the oracle's own call bracket plus what the painter parks under it. */
const SCRATCH_BYTES = 6;

const MOVED = ["a", "f", "sp"];
/** Read by the successor while still holding what this entry left — see the header. */
const LIVE_OUT = ["b", "c", "d", "e", "h", "l"];

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

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The module's own text against the helpers it is supposed to CALL. Each helper is identified by
 * a constant out of its own body; the module must name the helper's file, call it, and NOT carry
 * that constant. The same predicate is run over the helper itself as a positive control, so an
 * absence is only evidence once the check is shown able to see the thing present.
 */
const HELPERS = [
  ["paintSuppressedDigit", "../paintSuppressedDigit.js", "0x3246"],
  ["advanceCharCursor", "../advanceCharCursor.js", "u16(regs.de - 32)"],
];

function callsRatherThanRestates(text, [name, file, ownConstant]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    (text.includes(`${name}(m)`) || text.includes(`${name}(m,`)) &&
    !text.includes(ownConstant);
}

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
const DISPATCHES = { shared: 8, attract: 12, turning: 6 };

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
  if (entry === null) gate(paintTwoSuppressedDigitsFromByte);
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

/** Oracle vs candidate on clones: masked RAM, then every register outside the excluded set. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** A real captured machine with the packed byte, the flag, the cursor and the colour forced. */
function craft(value, flag, cursor, colour) {
  const m = entryState().clone();
  m.mem8[m.regs.hl] = value;
  m.regs.b = flag;
  m.regs.de = cursor;
  m.regs.c = colour;
  return m;
}

/**
 * The real cursor, a neighbour, one on the colour side, and a plane edge. Every cursor here keeps
 * all four writes inside RAM: the lowest one a run reaches is the cursor less 0x420.
 */
function cursors() {
  const real = entryState().regs.de;
  return [real, real - CELL_STEP, real & ~CHARACTER_PLANE_BIT, 0xa7ff];
}
const COLOURS = [0, 16];
/** No significant digit yet, one already seen, and the byte's top edge where the count wraps. */
const FLAGS = [0, 1, 255];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const cursor of cursors()) {
    for (const colour of COLOURS) {
      for (const flag of FLAGS) for (const value of everyByte) out.push([value, flag, cursor, colour]);
    }
  }
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const values = new Set();
  const flags = new Set();
  const seenCursors = new Set();
  const colours = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      values.add(mm.mem8[mm.regs.hl]);
      flags.add(mm.regs.b);
      seenCursors.add(mm.regs.de);
      colours.add(mm.regs.c);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, values, flags, cursors: seenCursors, colours };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, paintTwoSuppressedDigitsFromByte) }));
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
 * Every cell that EVER differs between an all-oracle run and one with the candidate wired. A
 * first-difference helper cannot express "differs only inside the scratch window", so this walks
 * the whole dump every frame and hands back the set.
 */
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

/**
 * Measured: with the correct rewrite wired, no cell differs at any frame boundary over the whole
 * run — the dead scratch this entry leaves is overwritten before the next sample. A twin verdict
 * is therefore measured against THIS set rather than against the window width.
 */
const STACK_TOP = 0xb000;
const STACK_FLOOR = 0xafd0;
const WHOLE_RUN_CELLS = [];

const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the low digit is painted first and the high one second. */
function brokenDigitsSwapped(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the painter that never suppresses is used, which is the sibling next door. */
function brokenUnsuppressed(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the flag is cleared between the digits, so the low one starts a fresh run. */
function brokenFlagResetBetween(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.b = 0;
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the flag the caller handed in is restored on the way out. */
function brokenFlagRestored(m) {
  const { regs, mem8 } = m;
  const flag = regs.b;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.b = flag;
}

/** BUG: the byte is not shifted down, so the low digit is painted twice. */
function brokenHighNotShifted(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the cursor is never stepped, so both digits land in the same cell. */
function brokenNoStep(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
}

/** BUG: only the high digit is painted; the cursor still ends two cells on. */
function brokenHighOnly(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  advanceCharCursor(m);
}

/** BUG: the run pointer is stepped between the digits, so the low digit comes from elsewhere. */
function brokenPointerStepped(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.hl = (regs.hl - 1) & 0xffff;
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.hl = (regs.hl + 1) & 0xffff;
}

/** BUG: the byte is read once and cached, so a paint that lands on it is not seen. */
function brokenCachesTheByte(m) {
  const { regs, mem8 } = m;
  const packed = mem8[regs.hl];
  regs.a = packed >> HIGH_DIGIT_SHIFT;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = packed;
  paintSuppressedDigit(m);
  advanceCharCursor(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 6144, [8, 12, 6], true],
  ["digits-swapped", brokenDigitsSwapped, 5756, [3, 5, 2], true],
  ["unsuppressed", brokenUnsuppressed, 6128, [7, 10, 5], true],
  ["flag-reset-between", brokenFlagResetBetween, 4096, [1, 6, 1], true],
  ["flag-restored", brokenFlagRestored, 6120, [3, 6, 2], true],
  ["high-not-shifted", brokenHighNotShifted, 4500, [3, 5, 2], true],
  ["no-step", brokenNoStep, 6144, [8, 12, 6], true],
  ["high-only", brokenHighOnly, 6080, [4, 12, 3], true],
  ["pointer-stepped", brokenPointerStepped, 5760, [5, 10, 3], true],
  ["caches-the-byte", brokenCachesTheByte, 0, [0, 0, 0], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(paintTwoSuppressedDigitsFromByte);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  paintTwoSuppressedDigitsFromByte(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: packed byte ${e.mem8[e.regs.hl]} at ${hex4(e.regs.hl)}, flag ${e.regs.b}, cursor ` +
      `${hex4(e.regs.de)}, colour ${e.regs.c}, sp ${hex4(sp)}; ${all.length} differing bytes, ` +
      `${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  for (const k of LIVE_OUT) assert.equal(a.regs[k], b.regs[k], `the declared live-out ${k} moved`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const [value, flag, cursor, colour] of cross()) {
    const a = craft(value, flag, cursor, colour);
    const b = a.clone();
    oracle(a);
    paintTwoSuppressedDigitsFromByte(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  // MOVED is a CEILING, not a set the rewrite is required to fill. deepEqual against it
  // would demand the divergence and go RED on a rewrite that became register-exact.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared cap diverged");
  for (const k of LIVE_OUT) assert.ok(!moved.has(k), `a declared live-out moved (${k})`);
});

test("UNIFORM CORPUS: how thin the real corpus is, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.values.size} bytes / ${s.flags.size} flags / ` +
      `${s.cursors.size} cursors / ${s.colours.size} colours`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const values = new Set(seen.flatMap((s) => [...s.values]));
  assert.ok(values.size < 256, "the corpus now covers every packed byte, so the crafted sweep is " +
    "no longer what covers the range");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("EXHAUSTIVE: every packed byte against every crafted flag, cursor and colour", { skip }, () => {
  for (const [value, flag, cursor, colour] of cross()) {
    const d = unitDiff(paintTwoSuppressedDigitsFromByte, craft(value, flag, cursor, colour));
    assert.equal(d, null, `byte ${value} flag ${flag} cursor ${hex4(cursor)}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} byte x flag x cursor x colour comparisons identical`);
});

test("THE FLAG CARRIES: it comes out changed, and the order of the digits matters", { skip }, () => {
  const cursor = entryState().regs.de;
  const stepped = [];
  for (const [value, flag] of [[0x00, 0], [0x01, 0], [0x10, 0], [0x11, 0], [0x00, 1]]) {
    const a = craft(value, flag, cursor, 16);
    const b = a.clone();
    oracle(a);
    paintTwoSuppressedDigitsFromByte(b);
    assert.equal(a.regs.b, b.regs.b, `the flag differs on byte ${value} from flag ${flag}`);
    stepped.push(`${value.toString(16)}/${flag}->${a.regs.b}`);
  }
  const straight = craft(0x10, 0, cursor, 16);
  const swapped = straight.clone();
  paintTwoSuppressedDigitsFromByte(straight);
  brokenDigitsSwapped(swapped);
  assert.notDeepEqual(straight.dumpState(), swapped.dumpState(), "painting the two digits the " +
    "other way round changes nothing, so the order this file fixes is not observable here");
  console.log(`  THE FLAG CARRIES: ${stepped.join(" ")}`);
});

/**
 * The run pointer aimed at the colour cell the FIRST paint fills. The second digit then comes from
 * the colour byte rather than the packed one, which is the only way to tell two reads from one.
 */
function craftOverlapping(colour, flag) {
  const m = entryState().clone();
  m.regs.c = colour;
  m.regs.b = flag;
  m.regs.hl = (m.regs.de & ~CHARACTER_PLANE_BIT) & 0xffff;
  return m;
}

test("TWO READS: the second digit follows a byte the first paint overwrote", { skip }, () => {
  const probe = craftOverlapping(0x37, 0);
  const after = probe.clone();
  oracle(after);
  assert.notEqual(probe.mem8[probe.regs.hl], 0x37, "the crafted colour must change the source byte");
  assert.equal(after.mem8[(probe.regs.de & ~CHARACTER_PLANE_BIT) & 0xffff], 0x37, "the paint did " +
    "not reach the cell the run pointer names, so this arm proves nothing");
  for (const colour of [0x37, 0x5a, 0x00]) {
    for (const flag of FLAGS) {
      const d = unitDiff(paintTwoSuppressedDigitsFromByte, craftOverlapping(colour, flag));
      assert.equal(d, null, `overlapping run pointer, colour ${colour} flag ${flag}: ${show(d)}`);
    }
  }
  assert.notEqual(unitDiff(brokenCachesTheByte, craftOverlapping(0x37, 0)), null, "the " +
    "cache-the-byte twin survives the overlapping entry, so nothing tests that it is read twice");
  console.log("  TWO READS: nine overlapping entries identical, and they catch the cached twin");
});

/**
 * Poison the accumulator and the flags register at each point the oracle comes back from the
 * painter. If either were live, the poisoned oracle would part company with the plain rewrite.
 */
function poisonedOracle(m) {
  const { regs, mem8 } = m;
  const spoil = () => {
    regs.a = 0xa5;
    regs.f = 0xff;
  };
  regs.a = mem8[regs.hl];
  regs.a = ((regs.a >> HIGH_DIGIT_SHIFT) | (regs.a << HIGH_DIGIT_SHIFT)) & 0xff;
  paintSuppressedDigit(m);
  spoil();
  advanceCharCursor(m);
  regs.a = mem8[regs.hl];
  paintSuppressedDigit(m);
  spoil();
  advanceCharCursor(m);
}

test("ACCUMULATOR IS DEAD AT THE PAINT: poisoning it changes nothing observable", { skip }, () => {
  let checked = 0;
  for (const [value, flag, cursor, colour] of cross()) {
    const clean = craft(value, flag, cursor, colour);
    const dirty = clean.clone();
    paintTwoSuppressedDigitsFromByte(clean);
    poisonedOracle(dirty);
    const strays = allDiffs(clean, dirty).filter((d) => !inScratch(d.addr, clean.regs.sp));
    assert.deepEqual(strays, [], `byte ${value} flag ${flag}: ${show(strays[0])}`);
    for (const k of REG_FIELDS) {
      if (MOVED.includes(k)) continue;
      assert.equal(clean.regs[k], dirty.regs[k], `poisoning moved ${k} at byte ${value}`);
    }
    checked++;
  }
  console.log(`  ACCUMULATOR IS DEAD: ${checked} crafted entries survive a poisoned handover`);
});

test("CALLS, NOT RESTATES: the module's text, with the helpers as positive controls", () => {
  const module = read("../paintTwoSuppressedDigitsFromByte.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper), `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(" and ")} are called, and ` +
    "neither of their bodies passes the same check");
});

test("HANDOVER: the digits, in order, at the cursors the steps produce", { skip }, () => {
  const marks = [];
  const stub = (m) => {
    marks.push([m.regs.a & LOW_NIBBLE, m.regs.de, m.regs.b]);
    m.regs.de |= CHARACTER_PLANE_BIT;
  };
  const stubbed = (m) => {
    const { regs, mem8 } = m;
    regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
    stub(m);
    advanceCharCursor(m);
    regs.a = mem8[regs.hl];
    stub(m);
    advanceCharCursor(m);
  };
  const probe = craft(0x47, 0, entryState().regs.de, 16);
  const painted = probe.clone();
  paintTwoSuppressedDigitsFromByte(painted);
  stubbed(probe);
  assert.equal(painted.regs.de, probe.regs.de, "the rewrite and the composition leave different " +
    "cursors, so the handover this arm reads is not the rewrite's");
  assert.deepEqual(marks.map((x) => x[0]), [4, 7], "the two digits handed over are not the packed " +
    "byte's nibbles in order");
  assert.equal(marks[1][1], (marks[0][1] | CHARACTER_PLANE_BIT) - CELL_STEP, "the cursor did not " +
    "move one cell between the two handovers");
  assert.deepEqual(marks.map((x) => x[2]), [0, 0], "the stub was handed a flag it never moved, so " +
    "the flag reaching the second paint is not the one this file carried in");
  console.log(`  HANDOVER: digits [${marks.map((x) => x[0]).join(",")}] handed over at ` +
    `[${marks.map((x) => hex4(x[1])).join(",")}]`);
});

test("WHOLE-MACHINE: a driven session leaves no cell differing", { skip }, () => {
  const r = wholeRunCells(paintTwoSuppressedDigitsFromByte);
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
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of cells a whole run leaves differing moved");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter(([v, f, u, c]) => unitDiff(twin, craft(v, f, u, c)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
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
    const seen = r.threw !== null || !sameCells(r.cells);
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-run verdict on the ${label} twin changed`);
  });
}
