// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintTwoUnsuppressedDigitsFromByte — memory-equivalent to the frozen oracle at ROM 0x0D81.
 *
 * WHAT IT IS. One packed byte painted as two digits: the high nibble, a cursor step, the low
 * nibble, another cursor step. Both the painter at ROM 0x0D90 and the cursor step at ROM 0x0020
 * ARE ALREADY DECOMPILED, so the rewrite calls paintUnsuppressedDigit and advanceCharCursor
 * directly and dissolving those four transfers belongs to this caller's unit.
 *
 * ★ THE DECLARED RANGE ENDS AT 0x0D8F AND THE PAINTER BEGINS AT 0x0D90, so a rewrite worked from
 *   the range rather than from the call graph would inline a routine that already has a name. It
 *   is not inlined here, and that is CHECKED rather than asserted: CALLS, NOT RESTATES reads the
 *   module's own text for the two imports and for the absence of a constant that belongs to each
 *   helper's body, and runs the same predicate over those helpers as a positive control, so the
 *   absence is only evidence once the check is shown able to see the thing present.
 *
 * ★ THIS FILE IS ALSO THE CHECK ON THE PAINTER'S OWN LIVE-OUT CLAIM. That gate excludes the
 *   accumulator and the flags on the grounds that its caller reloads them before any read. This
 *   IS that caller, and the claim is re-derived here rather than inherited: ACCUMULATOR IS DEAD
 *   AT THE PAINT arm poisons the accumulator and the flags at each of the two points the oracle
 *   returns from the painter, on every crafted entry, and asserts nothing observable moves.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT, so the bytes just below the entry stack pointer
 *   are dead scratch on one side only. The window is MEASURED and pinned, every arm walks the
 *   whole dump, and the EQUAL arm reports how much of the window is actually dirty rather than
 *   assuming it all is.
 *
 * LIVE-OUT, DERIVED FROM THE ORACLE. Two call sites reach this entry and BOTH return immediately
 *   after it, so by reading alone the live-out is MEMORY: the four cells painted. Walking one
 *   level further, every site those two return to either loads the accumulator before reading it
 *   or itself returns, and no site tests the flags. The registers are therefore not declared
 *   live — but the rewrite agrees with the oracle on all of them except the accumulator, the
 *   flags and the stack pointer anyway, and the gate holds that agreement to a CEILING: a
 *   register outside those three fails, while a rewrite that diverged on fewer would still pass.
 *   That is strictly more than the contract asks and it never requires a divergence.
 *
 * GATE: strict unit-capture with one measured exclusion, three replayed sessions at every
 *   dispatch, a crafted cross over the packed byte, the cursor and the colour, and a whole-run
 *   masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the scratch window.
 *   2. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell rather than a register.
 *   3. EXCLUDED — the registers that move over the whole cross, pinned by measurement.
 *   4. UNIFORM CORPUS — how many bytes, cursors and colours real play presents. It is thin and
 *      the numbers say how thin, which is why the crafted cross carries the weight.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. EXHAUSTIVE — all 256 packed bytes against several cursors and colours.
 *   7. TWO READS — the run pointer aimed at a cell the FIRST paint overwrites, so the second
 *      digit follows the overwritten byte. This is the only arm that can tell a rewrite reading
 *      the byte once from one reading it twice, and the cache-the-byte twin records that.
 *   8. ACCUMULATOR IS DEAD AT THE PAINT — the check on the painter's own excluded set.
 *   9. CALLS, NOT RESTATES — the module's text, with each helper's own body as a control.
 *  10. HANDOVER — the two digits, in order, at the cursors the steps produce.
 *  11. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame, every
 *      differing cell asserted to be a stack address and the exact set pinned.
 *  12. TEETH — nine twins, each with an exact catch count over the cross and per session. One is
 *      caught by NO crafted entry, NO real dispatch and no whole run — reading the byte once
 *      instead of twice only shows where a paint lands on the byte itself — so the TWO READS arm
 *      is the only thing holding it, and its verdicts record that rather than glossing it.
 *
 * HOLE: the cursors are the real one plus a handful of neighbours and two plane edges; nothing
 * here sweeps the tilemap, and a cursor arriving on the colour side is one crafted case.
 * HOLE: the corpus is three tapes off one attract-and-play sequence, not every screen.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0d81.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { paintTwoUnsuppressedDigitsFromByte } from "../paintTwoUnsuppressedDigitsFromByte.js";
import { paintUnsuppressedDigit } from "../paintUnsuppressedDigit.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { loc_0d81 as oracle } from "../../translated/loc_0d81.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0d81;

const CHARACTER_PLANE_BIT = 0x0400;
const CELL_STEP = 32;
const HIGH_DIGIT_SHIFT = 4;
const LOW_NIBBLE = 0x0f;
const GLYPHS = 0x0dcc;

/** Measured: the oracle's own call bracket plus what the painter parks under it. */
const SCRATCH_BYTES = 6;

const MOVED = ["a", "f", "sp"];

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
  ["paintUnsuppressedDigit", "../paintUnsuppressedDigit.js", "0x0dcc"],
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
const DISPATCHES = { shared: 7, attract: 7, turning: 6 };

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
  if (entry === null) gate(paintTwoUnsuppressedDigitsFromByte);
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

/** A real captured machine with the packed byte, the cursor and the colour forced. */
function craft(value, cursor, colour) {
  const m = entryState().clone();
  m.mem8[m.regs.hl] = value;
  m.regs.de = cursor;
  m.regs.c = colour;
  return m;
}

/**
 * The real cursor, two neighbours, one on the colour side, and two plane edges. Every cursor here
 * keeps all four writes inside RAM: the lowest one a run reaches is the cursor less 0x420.
 */
function cursors() {
  const real = entryState().regs.de;
  return [real, real - CELL_STEP, real + CELL_STEP, real & ~CHARACTER_PLANE_BIT, 0xa420, 0xa7ff];
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
      values.add(mm.mem8[mm.regs.hl]);
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
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, paintTwoUnsuppressedDigitsFromByte) }));
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

/** Measured over a whole run: the entry fires at more than one depth, so more than one address. */
const STACK_FLOOR = 0xafd0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [
  0xafdc, 0xafdd, 0xafde, 0xafdf, 0xafe0, 0xafe1, 0xafe2, 0xaff4, 0xaff6, 0xaff8, 0xaffc,
];

/**
 * A whole-run verdict has to be measured against the CORRECT rewrite's own cell set, not against
 * the window width: the correct rewrite already leaves eleven dead stack bytes differing, so a
 * "more than the window" test would report every twin caught and the correct code too.
 */
const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the low digit is painted first and the high one second. */
function brokenDigitsSwapped(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the byte is not shifted down, so the low digit is painted twice. */
function brokenHighNotShifted(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: only the first cursor step happens, so the second digit lands on the first. */
function brokenOneStep(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the cursor is never stepped, so both digits land in the same cell. */
function brokenNoStep(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
}

/** BUG: only the high digit is painted; the cursor still ends two cells on. */
function brokenHighOnly(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  advanceCharCursor(m);
}

/** BUG: the run pointer is stepped between the digits, so the low digit comes from elsewhere. */
function brokenPointerStepped(m) {
  const { regs, mem8 } = m;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.hl = (regs.hl - 1) & 0xffff;
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.hl = (regs.hl + 1) & 0xffff;
}

/** BUG: the byte is read once and cached, so a paint that lands on it is not seen. */
function brokenCachesTheByte(m) {
  const { regs, mem8 } = m;
  const packed = mem8[regs.hl];
  regs.a = packed >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = packed;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: the digits are painted straight rather than through the glyph table. */
function brokenPaintsRawDigits(m) {
  const { regs, mem8 } = m;
  for (const digit of [mem8[regs.hl] >> HIGH_DIGIT_SHIFT, mem8[regs.hl] & LOW_NIBBLE]) {
    mem8[regs.de] = digit & LOW_NIBBLE;
    mem8[regs.de & ~CHARACTER_PLANE_BIT] = regs.c;
    regs.de |= CHARACTER_PLANE_BIT;
    advanceCharCursor(m);
  }
  regs.a = regs.c;
}

const TWINS = [
  ["no-op", brokenNoOp, 6144, [7, 7, 6], true],
  ["digits-swapped", brokenDigitsSwapped, 5760, [1, 2, 1], true],
  ["high-not-shifted", brokenHighNotShifted, 4800, [1, 2, 1], true],
  ["one-step", brokenOneStep, 6144, [7, 7, 6], true],
  ["no-step", brokenNoStep, 6144, [7, 7, 6], true],
  ["high-only", brokenHighOnly, 6048, [4, 7, 4], true],
  ["pointer-stepped", brokenPointerStepped, 5760, [2, 5, 2], true],
  ["caches-the-byte", brokenCachesTheByte, 0, [0, 0, 0], false],
  ["paints-raw-digits", brokenPaintsRawDigits, 6144, [7, 7, 6], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(paintTwoUnsuppressedDigitsFromByte);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  paintTwoUnsuppressedDigitsFromByte(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: packed byte ${e.mem8[e.regs.hl]} at ${hex4(e.regs.hl)}, cursor ${hex4(e.regs.de)}, ` +
      `colour ${e.regs.c}, sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside ` +
      "the window",
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.de, b.regs.de, "the cursor left behind");
  assert.equal(a.regs.hl, b.regs.hl, "the run pointer must come back where it was");
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
  for (const [value, cursor, colour] of cross()) {
    const a = craft(value, cursor, colour);
    const b = a.clone();
    oracle(a);
    paintTwoUnsuppressedDigitsFromByte(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  // MOVED is a CEILING, not a set the rewrite is required to fill. deepEqual against it would
  // demand the divergence and go RED on a rewrite that became register-exact -- a gate that
  // requires a wart refuses the fix. Only a register OUTSIDE the ceiling fails here.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared cap diverged");
});

test("UNIFORM CORPUS: how thin the real corpus is, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.values.size} bytes / ${s.cursors.size} cursors / ` +
      `${s.colours.size} colours`).join("; ")}`,
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

test("EXHAUSTIVE: every packed byte against every crafted cursor and colour", { skip }, () => {
  for (const [value, cursor, colour] of cross()) {
    const d = unitDiff(paintTwoUnsuppressedDigitsFromByte, craft(value, cursor, colour));
    assert.equal(d, null, `byte ${value} cursor ${hex4(cursor)} colour ${colour}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} byte x cursor x colour comparisons identical`);
});

/**
 * The run pointer aimed at the colour cell the FIRST paint fills. The second digit then comes from
 * the colour byte rather than the packed one, which is the only way to tell two reads from one.
 */
function craftOverlapping(colour) {
  const m = entryState().clone();
  m.regs.c = colour;
  m.regs.hl = (m.regs.de & ~CHARACTER_PLANE_BIT) & 0xffff;
  return m;
}

test("TWO READS: the second digit follows a byte the first paint overwrote", { skip }, () => {
  const probe = craftOverlapping(0x37);
  const before = probe.mem8[probe.regs.hl];
  const after = probe.clone();
  oracle(after);
  assert.notEqual(before, 0x37, "the crafted colour must actually change the source byte");
  assert.equal(after.mem8[(probe.regs.de & ~CHARACTER_PLANE_BIT) & 0xffff], 0x37, "the paint did " +
    "not reach the cell the run pointer names, so this arm proves nothing");
  for (const colour of [0x37, 0x5a, 0x00]) {
    const d = unitDiff(paintTwoUnsuppressedDigitsFromByte, craftOverlapping(colour));
    assert.equal(d, null, `overlapping run pointer, colour ${colour}: ${show(d)}`);
  }
  assert.notEqual(unitDiff(brokenCachesTheByte, craftOverlapping(0x37)), null, "the cache-the-byte " +
    "twin survives the overlapping entry, so nothing here tests that the byte is read twice");
  console.log("  TWO READS: three overlapping entries identical, and they catch the cached twin");
});

/**
 * Poison the accumulator and the flags at each point the oracle comes back from the painter. If
 * either were live, the poisoned oracle would part company with the plain one.
 */
function poisonedOracle(m) {
  const { regs, mem8 } = m;
  const spoil = () => {
    regs.a = 0xa5;
    regs.f = 0xff;
  };
  regs.a = mem8[regs.hl];
  regs.a = ((regs.a >> HIGH_DIGIT_SHIFT) | (regs.a << HIGH_DIGIT_SHIFT)) & 0xff;
  paintUnsuppressedDigit(m);
  spoil();
  advanceCharCursor(m);
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  spoil();
  advanceCharCursor(m);
}

test("ACCUMULATOR IS DEAD AT THE PAINT: poisoning it changes nothing observable", { skip }, () => {
  let checked = 0;
  for (const [value, cursor, colour] of cross()) {
    const clean = craft(value, cursor, colour);
    const dirty = clean.clone();
    paintTwoUnsuppressedDigitsFromByte(clean);
    poisonedOracle(dirty);
    const strays = allDiffs(clean, dirty).filter((d) => !inScratch(d.addr, clean.regs.sp));
    assert.deepEqual(strays, [], `byte ${value} cursor ${hex4(cursor)}: ${show(strays[0])}`);
    for (const k of REG_FIELDS) {
      if (MOVED.includes(k)) continue;
      assert.equal(clean.regs[k], dirty.regs[k], `poisoning moved ${k} at byte ${value}`);
    }
    checked++;
  }
  console.log(`  ACCUMULATOR IS DEAD: ${checked} crafted entries survive a poisoned handover`);
});

test("CALLS, NOT RESTATES: the module's text, with the helpers as positive controls", () => {
  const module = read("../paintTwoUnsuppressedDigitsFromByte.js");
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
    marks.push([m.regs.a & LOW_NIBBLE, m.regs.de]);
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
  const probe = craft(0x47, entryState().regs.de, 16);
  const painted = probe.clone();
  paintTwoUnsuppressedDigitsFromByte(painted);
  stubbed(probe);
  assert.equal(painted.regs.de, probe.regs.de, "the rewrite and the composition leave different " +
    "cursors, so the handover this arm reads is not the rewrite's");
  assert.deepEqual(marks.map((x) => x[0]), [4, 7], "the two digits handed over are not the packed " +
    "byte's nibbles in order");
  assert.equal(marks[1][1], (marks[0][1] | CHARACTER_PLANE_BIT) - CELL_STEP, "the cursor did not " +
    "move one cell between the two handovers");
  const glyphs = marks.map((x) => painted.mem8[GLYPHS + x[0]]);
  assert.equal(painted.mem8[marks[0][1]], glyphs[0], "the first cell does not hold the first digit");
  assert.equal(painted.mem8[marks[1][1]], glyphs[1], "the second cell does not hold the second");
  console.log(`  HANDOVER: digits [${marks.map((x) => x[0]).join(",")}] handed over at ` +
    `[${marks.map((x) => hex4(x[1])).join(",")}]`);
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(paintTwoUnsuppressedDigitsFromByte);
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
