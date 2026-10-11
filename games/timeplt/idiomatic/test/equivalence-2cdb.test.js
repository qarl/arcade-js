// SPDX-License-Identifier: GPL-3.0-only
/**
 * blankOneLineThenGuardBlockOrDerailSequence — memory-equivalent to the frozen oracle at ROM 0x2CDB.
 *
 * WHAT IT IS. One turn of the line wipe at ROM 0x01C2, and, on the turn that clears the last line
 * owed, a 1024-byte exclusive-or fold of the program image whose result picks between the two
 * sequence steppers at ROM 0x0F11 and ROM 0x0F1A. Every callee is ALREADY DECOMPILED, so the
 * rewrite calls them directly and dissolving those transfers belongs to this caller's unit.
 *
 * ★ THE ORACLE PUSHES AND RETURNS, AND THE REWRITE DOES NEITHER. The wipe is reached by `call`, so
 *   the oracle brackets it with a pushed return address below the entry seat, and every exit takes
 *   a return the rewrite does not. That leaves DEAD STACK SCRATCH below the seat and moves several
 *   registers, the stack pointer and pc. The window is MEASURED — the WINDOW arm instruments the
 *   oracle's own `push16` over this file's whole sweep — never assumed and never copied from
 *   another gate. Every other arm walks the whole dump and masks ONLY that window.
 *
 * WHY THE LIVE-OUT IS MEMORY ONLY, derived from the ORACLE's exit successors and not from the
 *   module: every exit — the early return, and both tail jumps — returns to 0x181D, which
 *   is a bare `ret`, so no register this entry leaves is read before it is overwritten. Confirmed
 *   by running the tape: the oracle's pc after each captured dispatch is 0x181D.
 *
 * GATE: strict unit-capture replayed over every dispatch the tape produces, plus CRAFTED entries,
 *   because the tape only ever reaches this entry with lines still owed — the fold arm is
 *   unreachable without one. Nudges make it: the lines-owed cell forced to its last line, and,
 *   for the failing arm, ONE BYTE OF THE PROGRAM IMAGE FLIPPED, applied to the shared image so
 *   both sides read the same bytes and restored afterwards.
 *
 *   1. EQUAL      — identical across the whole state dump outside the measured window, over every
 *                   dispatch the tape produces.
 *   2. WINDOW     — the oracle's own deepest push, measured over the whole sweep and PINNED.
 *   3. BOUNDARY   — the exclusion is exactly as wide as it declares: one byte BELOW the window is
 *                   caught, one AT the entry seat is caught, one INSIDE is masked.
 *   4. ARMS       — every exit is really visited by the sweep, told apart by which sequence
 *                   cell the ORACLE moved, so no arm below is being scored on an unreached path.
 *   5. THE FOLD'S EXTENT — measured on the ORACLE, not read off the module: flipping the first
 *                   byte of the block flips the arm it takes, so does flipping the last, and
 *                   flipping the byte just before or just after the block does NOT. Two positives
 *                   and two negatives, which is what makes the extent a measurement.
 *   6. EXCLUDED   — no register outside the declared CEILING moves, with a two-sided control: a
 *                   planted move OUTSIDE the ceiling is reported and one INSIDE is not.
 *   7. CALLS, NOT RESTATES — the module's text: it must name each callee's file and call it rather
 *                   than carry that callee's body, with each callee's own body as a control.
 *   8. TEETH      — broken twins with measured catch counts over the sweep.
 *
 * HOLE: the wipe and the two steppers are gated by their own files. What this file gates is the
 * early exit, the extent and result of the fold, and which stepper each result picks.
 * HOLE: nothing here says what the folded block IS, only where it starts, how long it is, and what
 * total the untampered image gives.
 * HOLE: this gate pins the candidate's pc but leaves sp inside the excluded set, so a rewrite that
 * leaked stack without writing memory would pass here.
 * No gate now owns that: the whole-game gate idiomatic.test.js compares memory only, outside the
 * stack window, under an engine that leaves SP unused.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2cdb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { blankOneLineThenGuardBlockOrDerailSequence } from "../blankOneLineThenGuardBlockOrDerailSequence.js";
import { advanceSequencePhase } from "../advanceSequencePhase.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { blankNextLine } from "../blankNextLine.js";
import { loc_2cdb as oracle } from "../../translated/loc_2cdb.js";
import { BLANK_LINES_LEFT, BLANK_LINE_CURSOR, SEQUENCE_PHASE, SEQUENCE_SUBSTEP } from "../names.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u8 } from "../../../../core/int.js";

const TARGET = 0x2cdb;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const BLOCK_START = 0x4980;
const BLOCK_BYTES = 1024;
const UNTAMPERED_TOTAL = 0x43;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 2;

/**
 * The ceiling on register divergence, and the whole of it: the oracle walks the block through its
 * registers and takes a return the rewrite does not. Not a set the rewrite is REQUIRED to fill — a
 * rewrite that diverged on fewer still passes, so this can never refuse a fix.
 */
const CEILING = ["a", "f", "b", "d", "e", "h", "l", "sp"];
/** Outside the ceiling, so the EXCLUDED arm can show the measurement reports one. */
const OUTSIDE = "iy";

const CHARACTER_PLANE = 0xa400;
/** A plane address the wipe can walk a whole line from without leaving the two planes. */
const CRAFTED_CURSOR = 0xa400;
const PLANE_POISON = 0x5b;
const COLOUR_PLANE = 0xa000;
const PLANES_END = 0xa800;

/** Offsets inside the folded block, and the two bytes flanking it. */
const INSIDE_BLOCK = [BLOCK_START, BLOCK_START + BLOCK_BYTES / 2, BLOCK_START + BLOCK_BYTES - 1];
const OUTSIDE_BLOCK = [BLOCK_START - 1, BLOCK_START + BLOCK_BYTES];

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

const HELPERS = [
  ["blankNextLine", "../blankNextLine.js", "CHARACTER_PLANE_BIT"],
  ["advanceSequencePhase", "../advanceSequencePhase.js", "SEQUENCE_PHASE"],
  ["advanceSequenceSubStep", "../advanceSequenceSubStep.js", "SEQUENCE_SUBSTEP"],
];

function callsRatherThanRestates(text, [name, file, ownName]) {
  const called = new RegExp(`\\b${name}\\(\\s*m[,)]`);
  return text.includes(`from "./${file.slice(3)}"`) && called.test(text) && !text.includes(ownName);
}

// ── capture and craft ───────────────────────────────────────────────────────────────────

let entries = null;

function captured() {
  if (entries === null) {
    const got = [];
    const host = makeMachine(new Map([[TARGET, (mm) => {
      got.push(mm.clone());
      return oracle(mm);
    }]]));
    host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the tape stopped early: ${host.stoppedBy}`);
    entries = got;
  }
  assert.ok(entries.length > 0, "vacuous: the tape never reached the routine");
  return entries;
}

const entryState = () => captured()[0];

/**
 * A real captured machine nudged onto its LAST owed line, so the wipe's turn finishes and the fold
 * runs. Both planes carry a marker as well, so a candidate that skips the wipe is visible in them
 * rather than only in the cursor cells.
 */
function lastLine(linesLeft = 1) {
  const mm = entryState().clone();
  for (let a = COLOUR_PLANE; a < PLANES_END; a++) mm.mem8[a] = PLANE_POISON;
  mm.mem16[BLANK_LINE_CURSOR] = CRAFTED_CURSOR;
  mm.mem8[BLANK_LINES_LEFT] = linesLeft;
  return mm;
}

/**
 * Run `fn` with ONE byte of the shared program image flipped. Both sides read the same image, so
 * this is a crafted entry rather than two different machines; the byte is put back whatever
 * happens, or every arm after this one would be measuring a tampered image.
 */
function withFlippedImageByte(addr, fn) {
  const rom = entryState().rom;
  const at = addr - 0x0000;
  const was = rom[at];
  rom[at] = was ^ 0xff;
  try {
    return fn();
  } finally {
    rom[at] = was;
  }
}

/**
 * Every case this file compares on, as thunks, because three of them are only valid while the
 * image is flipped. Each calls back with a fresh machine and a label.
 */
function forEachCase(fn) {
  for (const [i, e] of captured().entries()) fn(e, `captured-${i}`);
  fn(lastLine(2), "two-lines-owed");
  fn(lastLine(), "last-line");
  for (const addr of INSIDE_BLOCK) {
    withFlippedImageByte(addr, () => fn(lastLine(), `tampered-${hex4(addr)}`));
  }
}

function caseCount() {
  let n = 0;
  forEachCase(() => n++);
  return n;
}

// ── comparison ──────────────────────────────────────────────────────────────────────────

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

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  try {
    candidate(b);
  } catch (e) {
    return { addr: null, reg: "raised", a: "returned", b: String(e).slice(0, 40) };
  }
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (CEILING.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

const show = (d) => {
  if (!d) return "identical";
  return d.addr === null
    ? `${d.reg}: oracle=${d.a} candidate=${d.b}`
    : `${hex4(d.addr)}: oracle=${d.a} candidate=${d.b}`;
};

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

/** Which exit the ORACLE takes on this machine, read off the two sequence cells it moves. */
function armOf(machine) {
  const before = machine.clone();
  const after = machine.clone();
  oracle(after);
  if (after.mem8[SEQUENCE_PHASE] !== before.mem8[SEQUENCE_PHASE]) return "phase";
  if (after.mem8[SEQUENCE_SUBSTEP] !== before.mem8[SEQUENCE_SUBSTEP]) return "sub-step";
  return "early";
}

function scribbler(offset) {
  return (m) => {
    const at = (m.regs.sp + offset) & 0xffff;
    oracle(m);
    m.mem8[at] ^= 0xff;
  };
}

function regScribbler(k) {
  return (m) => {
    oracle(m);
    m.regs[k] = m.regs[k] ^ 1;
  };
}

// ── broken twins ────────────────────────────────────────────────────────────────────────

function build(o = {}) {
  const opt = {
    wipe: true, earlyExit: true, start: BLOCK_START, length: BLOCK_BYTES,
    expected: UNTAMPERED_TOTAL, xor: true, swapArms: false, ...o,
  };
  return (m) => {
    const { mem8 } = m;
    const finished = opt.wipe ? blankNextLine(m) : true;
    if (opt.earlyExit && !finished) return;

    let total = 0;
    for (let i = 0; i < opt.length; i++) {
      total = opt.xor ? total ^ mem8[opt.start + i] : u8(total + mem8[opt.start + i]);
    }
    const matches = total === opt.expected;
    if (matches === opt.swapArms) {
      advanceSequencePhase(m);
      return;
    }
    advanceSequenceSubStep(m);
  };
}

/** BUG: does nothing — the twin that proves the comparison sees a real dispatch. */
function brokenNoOp() {}

/** BUG: steps the sequence but never wipes a line. */
const brokenNoWipe = build({ wipe: false });

const TWINS = [
  ["no-op", brokenNoOp],
  ["no-wipe", brokenNoWipe],
  ["never-returns-early", build({ earlyExit: false })],
  ["swapped-arms", build({ swapArms: true })],
  ["sums-instead-of-folding", build({ xor: false })],
  ["block-starts-one-byte-early", build({ start: BLOCK_START - 1 })],
  ["block-one-byte-short", build({ length: BLOCK_BYTES - 1 })],
  ["block-one-byte-long", build({ length: BLOCK_BYTES + 1 })],
  ["wrong-expected-total", build({ expected: UNTAMPERED_TOTAL + 1 })],
];

function caughtOver(candidate) {
  let caught = 0;
  let first = null;
  forEachCase((m) => {
    const d = unitDiff(candidate, m);
    if (!d) return;
    caught++;
    first ??= d;
  });
  return { caught, first };
}

/** Measured catch counts over the sweep. A move in any of them is a finding, and zeros are kept. */
const CATCHES = {
  "no-op": 32,
  "no-wipe": 32,
  // Every case whose wipe still owes a line, which is all but the ones that reach the fold.
  "never-returns-early": 27,
  // Both directions: the untampered cases take the other arm, and so do the tampered ones.
  "swapped-arms": 5,
  // ONLY the untampered cases. A tampered image fails a sum as surely as it fails a fold, so the
  // two agree there and this twin is invisible on three of the five cases that reach the fold.
  "sums-instead-of-folding": 2,
  "block-starts-one-byte-early": 2,
  "block-one-byte-short": 2,
  "block-one-byte-long": 2,
  // Same blindness as the sum twin, for the same reason.
  "wrong-expected-total": 2,
};

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at every real dispatch: identical outside the measured window", { skip }, () => {
  const all = captured();
  let worst = 0;
  for (const e of all) {
    const sp = e.regs.sp;
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    blankOneLineThenGuardBlockOrDerailSequence(b);
    const diffs = allDiffs(a, b);
    const strays = diffs.filter((d) => !inScratch(d.addr, sp));
    assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
    assert.ok(diffs.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
    assert.equal(b.pc, e.pc, "the dissolved chain never steps, so the rewrite leaves pc where it " +
      "found it; the oracle's pc is its caller's return address instead");
    worst = Math.max(worst, diffs.length);
  }
  console.log(
    `  EQUAL: ${all.length} dispatches within ${ENTRY_FRAMES} frames, seat ` +
      `${hex4(all[0].regs.sp)}; at most ${worst} differing bytes, all inside the window`,
  );
});

test("EQUAL over the crafted cases too, including a flipped image byte", { skip }, () => {
  const seen = [];
  forEachCase((m, label) => {
    if (label.startsWith("captured")) return;
    const d = unitDiff(blankOneLineThenGuardBlockOrDerailSequence, m);
    assert.equal(d, null, `${label}: ${show(d)}`);
    seen.push(label);
  });
  console.log(`  EQUAL (crafted): ${seen.join(", ")}`);
});

test("WINDOW: the oracle's own deepest push, measured over the whole sweep", { skip }, () => {
  let deepest = 0;
  forEachCase((m) => {
    deepest = Math.max(deepest, oracleDepth(m));
  });
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

test("BOUNDARY: the exclusion is exactly as wide as it declares", { skip }, () => {
  const sp = entryState().regs.sp;
  const below = unitDiff(scribbler(-SCRATCH_BYTES - 1), entryState());
  const seat = unitDiff(scribbler(0), entryState());
  const inside = unitDiff(scribbler(-1), entryState());
  console.log(
    `  BOUNDARY: ${hex4(sp - SCRATCH_BYTES - 1)} caught, ${hex4(sp)} caught, ` +
      `${hex4(sp - 1)} masked`,
  );
  assert.notEqual(below, null, "a divergence one byte BELOW the window was swallowed, so the " +
    "exclusion is wider than it declares and a leaking stack pointer would walk out of sight");
  assert.notEqual(seat, null, "a divergence AT the entry seat was swallowed: the window must lie " +
    "strictly below the seat, and live stack above it must still fail");
  assert.equal(inside, null, "a divergence INSIDE the window was caught, so the catches above " +
    "are the instrument catching everything rather than the boundary being where it says");
});

test("ARMS: every exit is really visited by the sweep", { skip }, () => {
  const arms = new Map();
  forEachCase((m, label) => {
    const arm = armOf(m);
    if (!arms.has(arm)) arms.set(arm, label);
  });
  for (const arm of ["early", "sub-step", "phase"]) {
    assert.ok(arms.has(arm), `no case in the sweep reaches the ${arm} exit, so every arm scored ` +
      "against it below is being scored on a path nothing takes");
  }
  console.log(`  ARMS: ${[...arms].map(([a, l]) => `${a} (first at ${l})`).join(", ")}`);
});

test("THE FOLD'S EXTENT, measured on the ORACLE", { skip }, () => {
  const clean = armOf(lastLine());
  assert.equal(clean, "sub-step", "the untampered image does not take the matching arm, so the " +
    "two flips below cannot be read as evidence about the block");
  const flipped = [];
  for (const addr of INSIDE_BLOCK) {
    withFlippedImageByte(addr, () => flipped.push([hex4(addr), armOf(lastLine())]));
  }
  const unflipped = [];
  for (const addr of OUTSIDE_BLOCK) {
    withFlippedImageByte(addr, () => unflipped.push([hex4(addr), armOf(lastLine())]));
  }
  for (const [where, arm] of flipped) {
    assert.equal(arm, "phase", `flipping ${where} did NOT change the arm, so that byte is not in ` +
      "the folded block and the block is narrower than this gate assumes");
  }
  for (const [where, arm] of unflipped) {
    assert.equal(arm, "sub-step", `flipping ${where} DID change the arm, so the block reaches ` +
      "past where this gate says it ends");
  }
  console.log(
    `  FOLD EXTENT: inside ${flipped.map(([w]) => w).join(" ")} flip the arm; ` +
      `flanking ${unflipped.map(([w]) => w).join(" ")} do not`,
  );
});

function movedOver(candidate) {
  const moved = new Set();
  forEachCase((m) => {
    const a = m.clone();
    const b = m.clone();
    oracle(a);
    try {
      candidate(b);
    } catch {
      return;
    }
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  });
  return moved;
}

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const outside = unitDiff(regScribbler(OUTSIDE), entryState());
  const inside = unitDiff(regScribbler(CEILING[0]), entryState());
  assert.notEqual(outside, null, `a planted move of ${OUTSIDE} was not reported, so a clean ` +
    "reading below proves nothing");
  assert.equal(inside, null, `a planted move of ${CEILING[0]} WAS reported, so the arm is not ` +
    "excluding the ceiling and the two-sided control has collapsed into one");
  const moved = movedOver(blankOneLineThenGuardBlockOrDerailSequence);
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${CEILING.join(", ")}; the control moves ${OUTSIDE} and is seen`);
  // CEILING is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !CEILING.includes(k)), [],
    "a register outside the declared ceiling diverged");
});

test("CALLS, NOT RESTATES: the module's text, with each callee as a positive control", () => {
  const module = read("../blankOneLineThenGuardBlockOrDerailSequence.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper),
      `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(", ")} each called, and ` +
    "each of their own bodies fails the same check");
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT`, { skip }, () => {
    const { caught, first: d } = caughtOver(twin);
    const total = caseCount();
    assert.ok(caught > 0, `the masked comparison PASSED the ${label} twin everywhere`);
    assert.equal(caught, CATCHES[label], `the ${label} twin's catch count moved`);
    assert.notEqual(d.addr, null, `the ${label} twin is caught on a register alone, so nothing ` +
      "says a cell it writes is wrong");
    console.log(`  TEETH/${label}: caught on ${caught} of ${total} — first ${show(d)}`);
  });
}

test("the wipe reaches the plane, so the no-wipe twin has something to catch", { skip }, () => {
  const before = lastLine();
  const after = before.clone();
  oracle(after);
  let touched = 0;
  for (let a = COLOUR_PLANE; a < PLANES_END; a++) if (after.mem8[a] !== PLANE_POISON) touched++;
  assert.ok(touched > 0, "no plane cell was written: the no-wipe twin rests on the cursor alone");
  assert.notEqual(after.mem8[CHARACTER_PLANE], PLANE_POISON, "the crafted cursor's own cell was " +
    "not written, so the crafted cursor does not point at the plane the wipe walks");
  console.log(`  WIPE REACHES: ${touched} plane cells written from ${hex4(CRAFTED_CURSOR)}`);
});
