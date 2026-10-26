// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintSixDigitFieldSuppressingLeadingZeros — memory-equivalent to the frozen oracle at ROM 0x0D73.
 *
 * WHAT IT IS. A six-digit field: two packed bytes through the suppressing pair-painter at ROM
 * 0x0DA0, then one through the plain pair-painter at ROM 0x0D81, with the run pointer stepped
 * back a byte between them. BOTH PAINTERS ARE ALREADY DECOMPILED, so the rewrite calls paintTwoSuppressedDigitsFromByte
 * and paintTwoUnsuppressedDigitsFromByte directly and dissolving those three transfers belongs to this caller's unit.
 *
 * ★ LIVE-OUT, DERIVED FROM THE ORACLE, NOT FROM THE MODULE. Four sites reach this entry. ROM
 *   0x4C1F CALLS it and returns to 0x4C4E, which immediately does `push hl` and then
 *   `ld hl,0xFFA0 / add hl,de` — SO HL AND DE ARE BOTH LIVE OUT, and the declared live-out is
 *   memory PLUS {d, e, h, l}. The other three sites (0x0D57, 0x0D61, 0x0D6B) reach it by tail
 *   transfer, so their live-out is their own callers': 0x0CDA, 0x0CF8, 0x0D12 and 0x162C all
 *   load the accumulator first, 0x0D1A is a bare `ret`, and 0x0CE8 is a bare `ret` that hands
 *   the question further out again.
 *   ★ I COULD NOT ESTABLISH THAT B AND C ARE DEAD at every site — the two bare-`ret` paths carry
 *   the question out of reach of this reading. Nothing is claimed about them; the rewrite agrees
 *   with the oracle on both anyway, and the ceiling below is what holds that.
 *   The ceiling is a CEILING: a register outside {a, f, sp} fails, a rewrite that diverged on
 *   fewer still passes. It never requires a divergence.
 *
 * ★ THE SUPPRESSION FLAG IS THE POINT OF THIS ENTRY. It is cleared here, carried through both
 *   suppressing pairs, and then NOT consulted by the plain pair — so the field's leading zeros
 *   are decided across four digits at once and the last two always show. Two twins attack
 *   exactly that (never clearing the flag, and painting all six through one painter), and their
 *   catch counts are what say the crafted sweep reaches the case.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT. The window is MEASURED by instrumenting the
 *   oracle's own pushes over the whole sweep, not inferred from the diff — a diff-derived window
 *   cannot see a pushed byte that already held its own value.
 *
 * GATE: strict unit-capture with one measured exclusion, every replayed session at every
 *   dispatch, a crafted cross over the three packed bytes and what arrives, and a whole-run
 *   masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the measured window, and the declared
 *      live-out asserted there. Its control is the arm below, on the same entry.
 *   2. NOT VACUOUS — a no-op FAILS that same masked diff, on a real cell.
 *   3. WINDOW — the oracle's deepest push over the whole sweep, measured.
 *   4. EXCLUDED — the registers that move over the sweep, bounded by the ceiling, with an
 *      in-arm control twin that moves one outside it so the clean reading means something.
 *   5. UNIFORM CORPUS — measured dispatch counts, and the bytes, cursors and colours real play
 *      presents.
 *   6. CORPUS — every dispatch of every session, on memory AND the declared live-out.
 *   7. CROSSED — every combination of a set of packed bytes at all three positions against each
 *      arriving flag, cursor and colour.
 *   8. EXHAUSTIVE PER POSITION — every byte value at each of the three positions in turn.
 *   9. THE FLAG IS CLEARED HERE — the same field paints the same cells whatever flag arrives,
 *      with the flag-forwarding twin shown NOT to, so the agreement is the rewrite's property.
 *  10. CALLS, NOT RESTATES — the module's text, with each painter's own body as a control.
 *  11. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame, every
 *      differing cell asserted to be a stack address and the exact set pinned.
 *  12. TEETH — a bank of twins, each with an exact catch count over the cross and per session,
 *      and its whole-run verdict recorded rather than assumed. One is recorded BLIND to both the
 *      whole run and the driven sessions: every dispatch the DRIVEN tape produces arrives with
 *      the flag already clear, so failing to clear it shows up only in the undriven session and
 *      in the crafted cross, and the verdicts say so instead of glossing it.
 *
 * HOLE: the crafted cursors are the real one plus neighbours; nothing here sweeps the tilemap.
 * HOLE: the corpus is three tapes off one attract-and-play sequence, not every screen.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0d73.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { paintSixDigitFieldSuppressingLeadingZeros } from "../paintSixDigitFieldSuppressingLeadingZeros.js";
import { paintTwoUnsuppressedDigitsFromByte } from "../paintTwoUnsuppressedDigitsFromByte.js";
import { paintTwoSuppressedDigitsFromByte } from "../paintTwoSuppressedDigitsFromByte.js";
import { loc_0d73 as oracle } from "../../translated/loc_0d73.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0d73;

const CELL_STEP = 32;

/** Measured by the WINDOW arm: the deepest the oracle's own pushes reach below the entry seat. */
const SCRATCH_BYTES = 8;

/** Derived from ROM 0x4C4E, which reads both pairs the moment this entry returns. */
const LIVE_OUT = ["d", "e", "h", "l"];

/** The ceiling on divergence. Not a set the rewrite is required to fill. */
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
 * The module's text against the painters it is supposed to CALL. Each is identified by a constant
 * out of its own body; the module must name the painter's file, call it, and NOT carry that
 * constant. The same predicate runs over each painter as a positive control, so an absence is
 * evidence only once the check is shown able to see the thing present.
 */
const HELPERS = [
  ["paintTwoSuppressedDigitsFromByte", "../paintTwoSuppressedDigitsFromByte.js", "HIGH_DIGIT_SHIFT"],
  ["paintTwoUnsuppressedDigitsFromByte", "../paintTwoUnsuppressedDigitsFromByte.js", "HIGH_DIGIT_SHIFT"],
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
const DISPATCHES = { shared: 4, attract: 6, turning: 3 };

/** The suppression flags real play arrives with. Measured; a move here is a finding. */
const ARRIVING_FLAGS_SEEN = [0, 1, 2];

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
  if (entry === null) gate(paintSixDigitFieldSuppressingLeadingZeros);
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
 * Oracle vs candidate on clones: masked RAM, then every register outside the ceiling — which
 * subsumes the declared live-out. A candidate aiming at the program image raises rather than
 * writing, and that counts as caught; only the candidate's side is wrapped, because a raise from
 * the oracle is a harness fault and must not be swallowed.
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

// ── the crafted cross ───────────────────────────────────────────────────────────────────

/** Packed bytes chosen for their nibbles: all-zero, leading zero, mid, saturated. */
const SAMPLE_BYTES = [0x00, 0x01, 0x09, 0x10, 0x90, 0x99, 0xff];

/** What arrives: the suppression flag, the first cell and the pen colour. */
const ARRIVING = [
  ["as captured", null],
  ["flag set", { b: 1, de: null, c: null }],
  ["flag saturated, cursor back", { b: 255, de: -CELL_STEP, c: 0 }],
  ["cursor on, colour saturated", { b: 3, de: CELL_STEP, c: 255 }],
];

function craft(bytes, arriving) {
  const m = entryState().clone();
  const base = m.regs.hl;
  for (const [i, v] of bytes.entries()) m.mem8[u16(base - i)] = v;
  if (arriving) {
    if (arriving.b !== null) m.regs.b = arriving.b;
    if (arriving.de !== null) m.regs.de = u16(m.regs.de + arriving.de);
    if (arriving.c !== null) m.regs.c = arriving.c;
  }
  return m;
}

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const high of SAMPLE_BYTES) {
    for (const mid of SAMPLE_BYTES) {
      for (const low of SAMPLE_BYTES) {
        for (const [label, arriving] of ARRIVING) out.push([[high, mid, low], arriving, label]);
      }
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
  const cursors = new Set();
  const colours = new Set();
  const flags = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      for (let i = 0; i < 3; i++) values.add(mm.mem8[u16(mm.regs.hl - i)]);
      cursors.add(mm.regs.de);
      colours.add(mm.regs.c);
      flags.add(mm.regs.b);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, values, cursors, colours, flags };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, paintSixDigitFieldSuppressingLeadingZeros) }));
  return sessionCache;
}

// ── the cycle shim ──────────────────────────────────────────────────────────────────────

/**
 * The oracle performs exactly one net return however it was entered — by a call from ROM 0x4C1F
 * or by a tail transfer from one of the three shims — so the host shim pays the measured
 * T-states and takes that one return on the rewrite's behalf.
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

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = sharedMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

/**
 * Every cell that EVER differs between an all-oracle run and one with the candidate wired. A
 * first-difference helper cannot express "differs only inside the scratch window", so this walks
 * the whole dump every frame and hands back the set.
 */
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
const WHOLE_RUN_CELLS = [
  0xafde, 0xafdf, 0xafe0, 0xafe1, 0xafe2, 0xafe3, 0xafe4, 0xafe5, 0xaff4, 0xaff5, 0xaff6, 0xaff7,
  0xaff8, 0xaff9, 0xaffa, 0xaffb, 0xaffc,
];

const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the suppression flag is left as the caller had it instead of being cleared. */
function brokenFlagNotCleared(m) {
  const { regs } = m;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the flag starts stepped on, so no leading zero is ever blanked. */
function brokenFlagStartsSet(m) {
  const { regs } = m;
  regs.b = 1;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the pointer never steps, so one byte is painted three times. */
function brokenPointerNotStepped(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoSuppressedDigitsFromByte(m);
  paintTwoSuppressedDigitsFromByte(m);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the pointer walks the other way. */
function brokenPointerStepsForward(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl + 1);
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl + 1);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the pointer only steps once, so the last two pairs share a byte. */
function brokenPointerStepsOnce(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the last pair suppresses too, so an all-zero field paints nothing at all. */
function brokenAllSuppressed(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
}

/** BUG: nothing suppresses, so the field's leading zeros all show. */
function brokenNoneSuppressed(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoUnsuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: the plain pair is painted first, so the field reads back to front. */
function brokenPlainPairFirst(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoUnsuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
}

/** BUG: the field is four digits, not six. */
function brokenTwoPairsOnly(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
}

/** BUG: a fourth pair is painted past the end of the field. */
function brokenExtraPair(m) {
  const { regs } = m;
  regs.b = 0;
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoSuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
  regs.hl = u16(regs.hl - 1);
  paintTwoUnsuppressedDigitsFromByte(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 1372, [4, 6, 3], true],
  ["flag-not-cleared", brokenFlagNotCleared, 1029, [0, 4, 0], false],
  ["flag-starts-set", brokenFlagStartsSet, 1372, [4, 6, 3], true],
  ["pointer-not-stepped", brokenPointerNotStepped, 1372, [4, 6, 3], true],
  ["pointer-steps-forward", brokenPointerStepsForward, 1372, [4, 6, 3], true],
  ["pointer-steps-once", brokenPointerStepsOnce, 1372, [4, 6, 3], true],
  ["all-suppressed", brokenAllSuppressed, 1180, [1, 2, 1], true],
  ["none-suppressed", brokenNoneSuppressed, 1372, [4, 6, 3], true],
  ["plain-pair-first", brokenPlainPairFirst, 1180, [4, 6, 3], true],
  ["two-pairs-only", brokenTwoPairsOnly, 1372, [4, 6, 3], true],
  ["extra-pair", brokenExtraPair, 1372, [4, 6, 3], true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the measured window", { skip }, () => {
  gate(paintSixDigitFieldSuppressingLeadingZeros);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  paintSixDigitFieldSuppressingLeadingZeros(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: bytes [${[0, 1, 2].map((i) => e.mem8[u16(e.regs.hl - i)]).join(",")}] at ` +
      `${hex4(e.regs.hl)}, cursor ${hex4(e.regs.de)}, colour ${e.regs.c}, flag ${e.regs.b}, ` +
      `sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside the window`,
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

test("WINDOW: the oracle's own deepest push, measured over the whole cross", { skip }, () => {
  let deepest = 0;
  for (const [bytes, arriving] of cross()) {
    deepest = Math.max(deepest, oracleDepth(craft(bytes, arriving)));
  }
  console.log(`  WINDOW (measured): the oracle reaches ${deepest} bytes below its seat`);
  assert.equal(deepest, SCRATCH_BYTES, "the oracle's stack footprint moved, so the masked window " +
    "is no longer the measured one and every arm below is masking the wrong bytes");
});

/** Which registers a candidate parts company with the oracle on, over the whole cross. */
function movedOver(candidate) {
  const moved = new Set();
  for (const [bytes, arriving] of cross()) {
    const a = craft(bytes, arriving);
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

test("EXCLUDED, deliberately: no register outside the ceiling moves", { skip }, () => {
  const moved = movedOver(paintSixDigitFieldSuppressingLeadingZeros);
  // The absence is evidence only if the same measurement CAN report a register outside the
  // ceiling; the twin that steps the pointer an extra time leaves it elsewhere.
  const control = movedOver(brokenExtraPair);
  assert.ok(REG_FIELDS.some((k) => control.has(k) && !MOVED.includes(k)),
    "the measurement reports nothing outside the ceiling even for a twin that moves the pointer " +
      "and the cursor, so a clean reading below proves nothing");
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")} — ` +
    `ceiling ${MOVED.join(", ")}; the control twin also moves ` +
    `${REG_FIELDS.filter((k) => control.has(k) && !MOVED.includes(k)).join(", ")}`);
  // MOVED is a CEILING. deepEqual against it would DEMAND the divergence and go RED on a rewrite
  // that became register-exact — a gate that requires a wart refuses the fix.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared ceiling diverged");
  for (const k of LIVE_OUT) assert.ok(!moved.has(k), `a declared live-out moved (${k})`);
});

test("UNIFORM CORPUS: what real play presents, measured", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.values.size} byte values / ` +
      `${s.cursors.size} cursors / ${s.colours.size} colours / flags [${[...s.flags].join(",")}]`)
      .join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const flags = [...new Set(seen.flatMap((s) => [...s.flags]))].sort((x, y) => x - y);
  assert.deepEqual(flags, ARRIVING_FLAGS_SEEN, "the suppression flags real play arrives with " +
    "moved, so the flag-not-cleared twin's real-dispatch counts describe a different corpus");
});

test("CORPUS: every dispatch of every session replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  assert.ok(total > 0, "vacuous: no session reaches the routine at all");
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("CROSSED: every sampled field against every arriving flag, cursor and colour", { skip }, () => {
  for (const [bytes, arriving, label] of cross()) {
    const d = unitDiff(paintSixDigitFieldSuppressingLeadingZeros, craft(bytes, arriving));
    assert.equal(d, null, `field [${bytes.join(",")}] arriving ${label}: ${show(d)}`);
  }
  console.log(`  CROSSED: ${cross().length} field x arriving comparisons identical`);
});

test("EXHAUSTIVE PER POSITION: every byte value at each of the three positions", { skip }, () => {
  let checked = 0;
  for (let position = 0; position < 3; position++) {
    for (const value of everyByte) {
      const bytes = [0x00, 0x00, 0x00];
      bytes[position] = value;
      const d = unitDiff(paintSixDigitFieldSuppressingLeadingZeros, craft(bytes, ARRIVING[0][1]));
      assert.equal(d, null, `position ${position} value ${value}: ${show(d)}`);
      checked++;
    }
  }
  console.log(`  EXHAUSTIVE PER POSITION: ${checked} single-position sweeps identical`);
});

test("THE FLAG IS CLEARED HERE: what arrives in it cannot reach the cells", { skip }, () => {
  const painted = (fn, bytes, arriving) => {
    const before = craft(bytes, arriving);
    const after = before.clone();
    fn(after);
    return allDiffs(before, after)
      .filter((d) => !inScratch(d.addr, before.regs.sp))
      .map((d) => `${hex4(d.addr)}=${d.b}`)
      .join(" ");
  };
  const FLAGS = [0, 1, 3, 255];
  let checked = 0;
  for (const bytes of [[0x00, 0x00, 0x00], [0x00, 0x01, 0x23], [0x00, 0x00, 0x07]]) {
    const reference = painted(paintSixDigitFieldSuppressingLeadingZeros, bytes, { b: FLAGS[0], de: null, c: null });
    for (const flag of FLAGS.slice(1)) {
      assert.equal(painted(paintSixDigitFieldSuppressingLeadingZeros, bytes, { b: flag, de: null, c: null }), reference,
        `field [${bytes.join(",")}] painted differently when the flag arrived as ${flag}`);
      checked++;
    }
  }
  // The tooth on this arm: the twin that forwards the caller's flag DOES vary with it.
  const leading = [0x00, 0x00, 0x07];
  const varies = FLAGS.slice(1).some((flag) =>
    painted(brokenFlagNotCleared, leading, { b: flag, de: null, c: null }) !==
    painted(brokenFlagNotCleared, leading, { b: FLAGS[0], de: null, c: null }));
  assert.ok(varies, "the flag-forwarding twin paints the same cells whatever arrives, so this arm " +
    "cannot tell a cleared flag from a forwarded one and proves nothing");
  console.log(`  THE FLAG IS CLEARED HERE: ${checked} comparisons agree, and the forwarding twin does not`);
});

test("CALLS, NOT RESTATES: the module's text, with the painters as positive controls", () => {
  const module = read("../paintSixDigitFieldSuppressingLeadingZeros.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper), `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log(`  CALLS, NOT RESTATES: ${HELPERS.map((h) => h[0]).join(" and ")} are called, and ` +
    "neither of their bodies passes the same check");
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(paintSixDigitFieldSuppressingLeadingZeros);
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
    const caught = cross().filter(([bytes, a]) => unitDiff(twin, craft(bytes, a)) !== null).length;
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
