// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintCreditCountPanel — memory-equivalent to the frozen oracle at ROM 0x4AFB.
 *
 * WHAT IT IS. Three constants and a transfer: a pen colour, a first cell, and the address of one
 * packed byte, handed to the two-digit painter at ROM 0x0D81 — WHICH IS ALREADY DECOMPILED, so
 * the rewrite calls paintTwoUnsuppressedDigitsFromByte directly and dissolving that transfer belongs to this caller's unit.
 * Everything the caller was holding in those three registers is overwritten before it is read.
 *
 * ★ LIVE-OUT, DERIVED FROM THE ORACLE, NOT FROM THE MODULE. The call sites that reach this entry
 *   are ROM 0x189E, 0x2D3F, 0x3215, 0x4941 and 0x496E. Reading each successor: 0x18C0 tail-jumps
 *   to 0x172A, which loads the accumulator immediately; 0x2D49 loads DE and then the accumulator;
 *   0x3234 calls 0x4B30, which loads HL and B first; 0x4984 and 0x4987 both begin
 *   `ld a,(0xA981)`. No successor reads a register this entry leaves, and none tests the flags.
 *   THE DECLARED LIVE-OUT IS THEREFORE MEMORY ONLY. The rewrite nevertheless agrees with the
 *   oracle on every register except the accumulator, the flags, the pointer in HL and the stack
 *   pointer, and the gate holds that agreement as a CEILING — a register outside those fails, a
 *   rewrite that diverged on fewer still passes. That is strictly more than the contract asks and
 *   it never requires a divergence. HL, which the oracle leaves on the credit count, is measured
 *   dead where this entry hands back (DEAD AT EXIT, with the SP flip at the same exit heard).
 *
 * ★ THE REAL CORPUS IS ALMOST CONSTANT. The packed byte barely varies across the sessions, and
 *   the panel is mostly already showing what gets painted, so much of what the oracle writes is
 *   what was there. The crafted sweep is what carries this gate, and the corpus arm measures the
 *   thinness rather than describing it.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT. The window is MEASURED, not assumed: the WINDOW
 *   arm instruments the oracle's own pushes over the whole sweep and reports the deepest stack
 *   pointer it reaches. Every other arm walks the whole dump and masks only that window.
 *
 * GATE: strict unit-capture with one measured exclusion, every replayed session at every
 *   dispatch, an exhaustive sweep of the packed byte crossed with hostile incoming registers,
 *   and a whole-run masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the measured window. Its control is the
 *      arm below, which runs the same masked diff on the same entry and must FAIL.
 *   2. NOT VACUOUS — a no-op FAILS that same masked diff, on a real cell rather than a register.
 *   3. WINDOW — the oracle's deepest push over the whole sweep, measured, not inferred from the
 *      diff; a diff-derived window cannot see a pushed byte that already held its own value.
 *   4. EXCLUDED — the registers that move over the sweep, bounded by the ceiling above, with a
 *      twin that moves the cursor as the in-arm control that the measurement can see one.
 *   5. UNIFORM CORPUS — measured dispatch counts and which packed bytes real play presents.
 *   6. CORPUS — every dispatch of every session.
 *   7. EXHAUSTIVE — every packed byte against each incoming register set.
 *   8. DISCARDS WHAT ARRIVES — one packed byte painted with different incoming colours, cursors
 *      and pointers lands the same cells, and the colour-forwarding twin is shown NOT to, so the
 *      agreement is a property of the rewrite rather than of the comparison.
 *   9. CALLS, NOT RESTATES — the module's text, with the painter's own body as a control.
 *  10. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame, every
 *      differing cell asserted to be a stack address and the exact set pinned.
 *  11. TEETH — a bank of twins, each with an exact catch count over the sweep and per session,
 *      and its whole-run verdict recorded rather than assumed. One is recorded BLIND to the
 *      whole run: leaving the plane bit off the cursor is overwritten by the caller, so only the
 *      register ceiling holds it.
 *
 * HOLE: the destination cells and the source byte are constants of the entry, so no arm here
 * varies WHERE it paints; the twins send it elsewhere instead and measure that the sweep sees it.
 * HOLE: the corpus is three tapes off one attract-and-play sequence, not every screen.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4afb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { paintCreditCountPanel } from "../paintCreditCountPanel.js";
import { TAPE_SESSIONS, assertDeadAtExit } from "./_deadAtExit.js";
import { paintTwoUnsuppressedDigitsFromByte } from "../paintTwoUnsuppressedDigitsFromByte.js";
import { paintTwoSuppressedDigitsFromByte } from "../paintTwoSuppressedDigitsFromByte.js";
import { paintUnsuppressedDigit } from "../paintUnsuppressedDigit.js";
import { advanceCharCursor } from "../advanceCharCursor.js";
import { loc_4afb as oracle } from "../../translated/loc_4afb.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x4afb;

/** The three constants the entry exists to choose. */
const PEN_COLOUR = 16;
const FIRST_CELL = 0xa47f;
const PACKED_BYTE = 0xa986;

const CELL_STEP = 32;
const HIGH_DIGIT_SHIFT = 4;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 8;

/** The ceiling on divergence. Not a set the rewrite is required to fill. */
/**
 * c (the pen colour) is NOT a live-out: the painter now takes its colour as an argument, so the rewrite
 * leaves c alone where the oracle leaves the colour in it. Measured on the ORACLE: in the frozen game, c poisoned (0x00/0x5a/0xa5/0xff) at every return
 * reached (0x2D49, 0x3234, 0x4984; coin + service-credit session)
 * leaves RAM (minus dead stack scratch below SP), pc and SP identical frame by frame over the
 * session, where the same probe on drawRandomByte's A (a real live-out) forks.
 */
const MOVED = ["a", "f", "sp", "c", "h", "l"];
const DEAD_FRAMES = 2500;

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
 * The module's text against the painter it is supposed to CALL. The painter is identified by a
 * constant out of its own body; the module must name the painter's file, call it, and NOT carry
 * that constant. The same predicate runs over the painter itself as a positive control, so the
 * absence is evidence only once the check is shown able to see the thing present.
 */
const HELPER = ["paintTwoUnsuppressedDigitsFromByte", "../paintTwoUnsuppressedDigitsFromByte.js", "HIGH_DIGIT_SHIFT"];

function callsRatherThanRestates(text, [name, file, ownConstant]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m`) &&
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
const DISPATCHES = { shared: 3, attract: 1, turning: 3 };

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
  if (entry === null) gate(paintCreditCountPanel);
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

/**
 * Oracle vs candidate on clones: masked RAM, then every register outside the ceiling. A candidate
 * that AIMS AT THE PROGRAM IMAGE raises rather than writing, and one twin does exactly that, so a
 * raise counts as caught. Only the candidate's side is wrapped: a raise from the oracle is a
 * harness fault and must not be swallowed.
 */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, a: "returned", b: `raised ${String(e).slice(0, 40)}` };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** How far below its seat the oracle's own pushes take the stack pointer, on one entry state. */
function oracleDepth(machine) {
  const c = machine.clone();
  const seat = c.regs.sp;
  let deepest = seat;
  const push = c.push16.bind(c);
  c.push16 = (v) => {
    const r = push(v);
    if (c.regs.sp < deepest) deepest = c.regs.sp;
    return r;
  };
  oracle(c);
  return seat - deepest;
}

/**
 * A real captured machine with the packed byte forced and a chosen set of registers arriving.
 * The entry overwrites all three before reading them, so these are the arm that proves it.
 */
const ARRIVING = [
  ["as captured", null],
  ["clear", { c: 0, de: 0xa7ff, hl: 0xa800 }],
  ["saturated", { c: 255, de: 0xa420, hl: 0xafff }],
  ["crossed", { c: 7, de: PACKED_BYTE, hl: FIRST_CELL }],
];

function craft(value, arriving) {
  const m = entryState().clone();
  m.mem8[PACKED_BYTE] = value;
  if (arriving) {
    m.regs.c = arriving.c;
    m.regs.de = arriving.de;
    m.regs.hl = arriving.hl;
  }
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const [label, arriving] of ARRIVING) for (const v of everyByte) out.push([v, arriving, label]);
  crossCache = out;
  return out;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const values = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      values.add(mm.mem8[PACKED_BYTE]);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, values };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, paintCreditCountPanel) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

/**
 * Every path in arrives by a call whose return the oracle takes, so the shim pays the oracle's
 * measured T-states and takes that return on the rewrite's behalf.
 */
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

const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;

/** Measured over a whole run with the CORRECT rewrite wired. A twin is caught by differing. */
const WHOLE_RUN_CELLS = [0xafdc, 0xafdd, 0xafde, 0xafdf, 0xafe0, 0xafe1, 0xafe2, 0xafe3];

const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the suppressing painter is used, so a leading zero blanks and the flag is stepped. */
function brokenSuppressingPainter(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE;
  paintTwoSuppressedDigitsFromByte(m);
}

/** BUG: the pen colour is one off. */
function brokenWrongColour(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR + 1;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE;
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: whatever colour the caller was holding is used instead of the entry's own. */
function brokenKeepsCallerColour(m) {
  const { regs } = m;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE;
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: whatever cursor the caller was holding is used, so the digits land elsewhere. */
function brokenKeepsCallerCursor(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR;
  regs.hl = PACKED_BYTE;
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: whatever pointer the caller was holding is read, so the digits come from elsewhere. */
function brokenKeepsCallerPointer(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL;
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the field starts one cell along. */
function brokenCursorOneCellOn(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL - CELL_STEP;
  regs.hl = PACKED_BYTE;
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the byte next door is painted instead. */
function brokenSourceNextByte(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE + 1;
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the two digits change places. */
function brokenDigitsSwapped(m) {
  const { regs, mem8 } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE;
  regs.a = mem8[regs.hl];
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
}

/** BUG: only the high digit is painted; the cursor still ends two cells on. */
function brokenHighDigitOnly(m) {
  const { regs, mem8 } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE;
  regs.a = mem8[regs.hl] >> HIGH_DIGIT_SHIFT;
  paintUnsuppressedDigit(m);
  advanceCharCursor(m);
  advanceCharCursor(m);
}

/** BUG: the colour goes down but the glyph plane bit is left off the cursor afterwards. */
function brokenCursorLeftOffPlane(m) {
  const { regs } = m;
  regs.c = PEN_COLOUR;
  regs.de = FIRST_CELL;
  regs.hl = PACKED_BYTE;
  paintTwoUnsuppressedDigitsFromByte(m);
  regs.de &= ~0x0400;
}

const TWINS = [
  ["no-op", brokenNoOp, 1024, [3, 1, 3], true],
  ["suppressing-painter", brokenSuppressingPainter, 1020, [2, 0, 2], true],
  ["wrong-colour", brokenWrongColour, 1024, [3, 1, 3], true],
  ["keeps-caller-colour", brokenKeepsCallerColour, 1024, [3, 1, 3], true],
  ["keeps-caller-cursor", brokenKeepsCallerCursor, 1024, [3, 1, 3], true],
  ["keeps-caller-pointer", brokenKeepsCallerPointer, 1020, [1, 1, 1], true],
  ["cursor-one-cell-on", brokenCursorOneCellOn, 1024, [3, 1, 3], true],
  ["source-next-byte", brokenSourceNextByte, 1020, [2, 1, 2], true],
  ["digits-swapped", brokenDigitsSwapped, 960, [1, 0, 1], true],
  ["high-digit-only", brokenHighDigitOnly, 960, [3, 1, 3], true],
  ["cursor-left-off-plane", brokenCursorLeftOffPlane, 1024, [3, 1, 3], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the measured window", { skip }, () => {
  gate(paintCreditCountPanel);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  paintCreditCountPanel(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: packed byte ${e.mem8[PACKED_BYTE]}, arriving colour ${e.regs.c} cursor ` +
      `${hex4(e.regs.de)} pointer ${hex4(e.regs.hl)}, sp ${hex4(sp)}; ${all.length} differing ` +
      `bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  for (const [value, arriving] of cross()) {
    deepest = Math.max(deepest, oracleDepth(craft(value, arriving)));
  }
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

/** Which registers a candidate parts company with the oracle on, over the whole sweep. */
function movedOver(candidate) {
  const moved = new Set();
  for (const [value, arriving] of cross()) {
    const a = craft(value, arriving);
    const b = a.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      continue;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  return moved;
}

test("HL IS DEAD AT EXIT: the pointer the oracle leaves is read by no caller", { skip }, () => {
  assertDeadAtExit({ at: TARGET, poison: ["h", "l"], sessions: TAPE_SESSIONS, frames: DEAD_FRAMES });
});

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(paintCreditCountPanel);
  // The absence below is only evidence if the same measurement CAN report a register outside the
  // ceiling. The plane-bit twin leaves the cursor elsewhere, and the control asserts it is seen.
  const control = movedOver(brokenCursorLeftOffPlane);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that moves the cursor, " +
      "so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

test("UNIFORM CORPUS: how thin the real corpus is, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / packed bytes [${[...s.values].join(",")}]`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const values = new Set(seen.flatMap((s) => [...s.values]));
  assert.ok(values.size < 256, "the corpus now covers every packed byte, so the crafted sweep is " +
    "no longer what covers the range and this file's account of itself is wrong");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("EXHAUSTIVE: every packed byte against every incoming register set", { skip }, () => {
  for (const [value, arriving, label] of cross()) {
    const d = unitDiff(paintCreditCountPanel, craft(value, arriving));
    assert.equal(d, null, `byte ${value} arriving ${label}: ${show(d)}`);
  }
  console.log(`  EXHAUSTIVE: ${cross().length} byte x arriving-register comparisons identical`);
});

test("DISCARDS WHAT ARRIVES: the same byte paints the same cells whatever arrives", { skip }, () => {
  const painted = (fn, value, arriving) => {
    const before = craft(value, arriving);
    const after = before.clone();
    fn(after);
    return allDiffs(before, after)
      .filter((d) => !inScratch(d.addr, before.regs.sp))
      .map((d) => `${hex4(d.addr)}=${d.b}`)
      .join(" ");
  };
  let checked = 0;
  for (const value of everyByte) {
    const reference = painted(paintCreditCountPanel, value, ARRIVING[0][1]);
    for (const [label, arriving] of ARRIVING.slice(1)) {
      assert.equal(painted(paintCreditCountPanel, value, arriving), reference,
        `byte ${value} painted differently when ${label} arrived`);
      checked++;
    }
  }
  // The tooth on this arm: a candidate that forwards the caller's colour DOES vary with what
  // arrives, so the equality above is a property of the rewrite and not of the comparison.
  const varies = ARRIVING.slice(1).some(([, arriving]) =>
    painted(brokenKeepsCallerColour, 0x47, arriving) !== painted(brokenKeepsCallerColour, 0x47, ARRIVING[0][1]));
  assert.ok(varies, "the colour-forwarding twin paints the same cells whatever arrives, so this " +
    "arm cannot tell a discarded register from a used one and proves nothing");
  console.log(`  DISCARDS WHAT ARRIVES: ${checked} comparisons agree, and the forwarding twin does not`);
});

test("CALLS, NOT RESTATES: the module's text, with the painter as a positive control", () => {
  const module = read("../paintCreditCountPanel.js");
  assert.ok(callsRatherThanRestates(module, HELPER), `the module does not call ${HELPER[0]}`);
  assert.ok(!callsRatherThanRestates(read(HELPER[1]), HELPER), `the check passes ${HELPER[0]}'s ` +
    "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  console.log(`  CALLS, NOT RESTATES: ${HELPER[0]} is called, and its own body fails the same check`);
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(paintCreditCountPanel);
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
    const caught = cross().filter(([v, a]) => unitDiff(twin, craft(v, a)) !== null).length;
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
