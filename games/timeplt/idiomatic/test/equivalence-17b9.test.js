// SPDX-License-Identifier: GPL-3.0-only
/**
 * guardBlockOrBlankDisplay — memory-equivalent to the frozen oracle at ROM 0x17B9.
 *
 * WHAT IT IS. A running eight-bit total over fifty-one bytes of the program image, started from a
 * fifty-second, compared against one expected value. On a match the inner sequence index is
 * stepped through the already-decompiled advanceSequenceSubStep, so that tail transfer is
 * dissolved into a direct call here. On a mismatch the display latch is written and one character
 * cell is copied, glyph and colour, into a pair of work cells.
 *
 * ★ THE FAILURE ARM IS UNREACHABLE ON A GENUINE IMAGE, and this file does not pretend otherwise.
 *   Every byte the total reads is program image, so no poke of work RAM can reach that arm — which
 *   is exactly why the crafted arms give ONE machine a private copy of the image with a single
 *   byte moved. Both sides then share that copy, the total misses, and the failure arm runs for
 *   real. Without it every twin below that touches the failure arm would be invisible.
 *
 * ★ ONE READ IS DROPPED ON PURPOSE. The oracle loads a program byte into a register nothing reads
 *   again before it is overwritten, and the rewrite does not load it at all. That is a claim about
 *   the callers, so it is MEASURED: a whole session with that register forced hostile after the
 *   dispatch is bit-identical to the clean run, and the tooth beside it shows the instrument
 *   actually reaches the routine.
 *
 * GATE: strict unit-capture, three replayed sessions, an altered-image pair, a hostile-register
 *   instrument, and a whole-run diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical.
 *   2. NOT VACUOUS — a no-op FAILS that same diff.
 *   3. EXCLUDED — the registers that move, BOUNDED on both arms: their union over the clean and
 *      altered entries may contain nothing outside the declared set, and a rewrite that clobbers
 *      fewer of them is an improvement and stays green. The measured union is logged.
 *   4. TAPE REACH — measured: only the undriven session reaches this entry, once.
 *   5. CORPUS — that dispatch replayed.
 *   6. THE TOTAL — the total the image actually produces, read back rather than asserted, and the
 *      value the comparison wants. The seed byte reads ZERO on this image, so starting from it and
 *      starting from nothing are the same routine here; that is recorded rather than gated.
 *   7. FAILURE ARM — the altered-image machine, where the two sides must still agree and where
 *      the write set is the failure arm's rather than the clean arm's.
 *   8. THE DROPPED READ — forced hostile over a whole session, with a tooth on the instrument.
 *   9. WHOLE-MACHINE — an undriven session with the rewrite wired, diffed every frame.
 *  10. TEETH — ten twins, each with a verdict on the genuine image AND on the altered one, and an
 *      assertion that no twin is blind to both.
 *
 * HOLE: exactly ONE dispatch exists in any session, so the corpus cannot vary anything. Every
 * discriminating arm here is either the altered-image pair or the whole run.
 * HOLE: the altered image moves ONE byte. Nothing here sweeps the guarded block.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-17b9.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { guardBlockOrBlankDisplay } from "../guardBlockOrBlankDisplay.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { SEQUENCE_SUBSTEP, TAMPER_WITNESS } from "../names.js";
import { loc_17b9 as oracle } from "../../translated/loc_17b9.js";
import { firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { recordHardwareWrites } from "./_spineSever.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x17b9;

const TOTAL_SEED = 0x4a40;
const GUARDED_FIRST = 0x0b06;
const GUARDED_BYTES = 51;
const EXPECTED_TOTAL = 239;
const BLANKING_VALUE = 0x4c89;
const DISPLAY_LATCH = 0xc308;
const LATCH_WRITE_OFFSET = 10;
const SAMPLED_CELL = 0xa65c;
const CHARACTER_PLANE_BIT = 0x0400;

const MOVED = ["a", "f", "b", "c", "h", "l", "sp"];

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

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const sharedMachine = (overrides) => makeMachine(overrides);
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });

const SESSIONS = [
  ["attract", attractMachine],
  ["shared", sharedMachine],
  ["turning", turningMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured. */
const DISPATCHES = { attract: 1, shared: 0, turning: 0 };

// ── the entry, and the comparison ───────────────────────────────────────────────────────

let entry = null;

function gate(candidate) {
  return unitEquivalence(
    attractMachine,
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
  if (entry === null) gate(guardBlockOrBlankDisplay);
  return entry;
}

/**
 * RAM first, then what the dump cannot see: the ordered device writes (address and value, recorded
 * on both sides) and the latch lines they leave — the failure arm's display write lands there.
 */
function devicesDiff(a, b, drovenA, drovenB) {
  const seq = (log) => log.map((w) => `${hex4(w.addr)}=${w.value}`).join(" ");
  if (seq(drovenA) !== seq(drovenB)) return { addr: null, a: seq(drovenA), b: seq(drovenB) };
  if (a.io.latch.join() !== b.io.latch.join()) return { addr: null, a: a.io.latch.join(), b: b.io.latch.join() };
  return null;
}

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const drovenA = recordHardwareWrites(a);
  const drovenB = recordHardwareWrites(b);
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)) ??
    devicesDiff(a, b, drovenA, drovenB);
}

/**
 * The real captured machine with ONE byte of the guarded block moved, on a private image — and
 * with the cells the failure arm reads and writes given distinct priors, so that arm's write set
 * is OBSERVABLE. Without those priors the copy writes bytes that already match and the arm looks
 * inert.
 */
const SAMPLE_GLYPH = 0x33;
const SAMPLE_COLOUR = 0x44;

function altered(offset = 0) {
  const m = entryState().clone();
  m.mem.rom = Uint8Array.from(m.mem.rom);
  m.mem.rom[GUARDED_FIRST + offset] = (m.mem.rom[GUARDED_FIRST + offset] + 1) & 0xff;
  m.mem8[SAMPLED_CELL] = SAMPLE_GLYPH;
  m.mem8[SAMPLED_CELL & ~CHARACTER_PLANE_BIT] = SAMPLE_COLOUR;
  m.mem8[TAMPER_WITNESS] = 0x11;
  m.mem8[TAMPER_WITNESS + 1] = 0x22;
  return m;
}

/** Oracle vs candidate on two machines sharing one altered image. */
function alteredDiff(candidate, offset = 0) {
  const a = altered(offset);
  const b = a.clone();
  b.mem.rom = a.mem.rom;
  const drovenA = recordHardwareWrites(a);
  const drovenB = recordHardwareWrites(b);
  oracle(a);
  candidate(b);
  return firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off)) ??
    devicesDiff(a, b, drovenA, drovenB);
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, guardBlockOrBlankDisplay) }));
  return sessionCache;
}

// ── the whole-run diff, and the hostile-register instrument ─────────────────────────────

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
    const base = attractMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRun(wire) {
  const base = baseline();
  let fired = 0;
  const host = attractMachine(new Map([[TARGET, (mm) => (fired++, wire(mm))]]));
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
  return { cells: [...cells], frames: n, fired, threw };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the guarded block starts one byte early, so the block it covers is the wrong one. */
function brokenBlockOffByOne(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST - 1 + i]) & 0xff;
  if (total === EXPECTED_TOTAL) advanceSequenceSubStep(m);
  else failureArm(m);
}

/** BUG: one byte short, so a change in the last guarded byte goes unnoticed. */
function brokenOneByteShort(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES - 1; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total === EXPECTED_TOTAL) advanceSequenceSubStep(m);
  else failureArm(m);
}

/** BUG: the total is not truncated, so it can never match once it passes a byte. */
function brokenNoWrap(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total += m.mem8[GUARDED_FIRST + i];
  if (total === EXPECTED_TOTAL) advanceSequenceSubStep(m);
  else failureArm(m);
}

/** BUG: the expected total is one out, so a genuine image takes the failure arm. */
function brokenExpectedOffByOne(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total === EXPECTED_TOTAL + 1) advanceSequenceSubStep(m);
  else failureArm(m);
}

/** BUG: the guard is inverted. */
function brokenInverted(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total !== EXPECTED_TOTAL) advanceSequenceSubStep(m);
  else failureArm(m);
}

/** BUG: the sequence index is never stepped, so the sequence stalls on a genuine image. */
function brokenNoAdvance(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total !== EXPECTED_TOTAL) failureArm(m);
}

/** The correct failure arm, so a twin can break ONE thing about it. */
function failureArm(m) {
  m.mem.write8(DISPLAY_LATCH, m.mem8[BLANKING_VALUE], LATCH_WRITE_OFFSET);
  m.mem8[TAMPER_WITNESS] = m.mem8[SAMPLED_CELL];
  m.mem8[TAMPER_WITNESS + 1] = m.mem8[SAMPLED_CELL & ~CHARACTER_PLANE_BIT];
}

/** BUG: the failure arm copies the glyph twice and never the colour. */
function brokenFailureCopiesGlyphTwice(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total === EXPECTED_TOTAL) {
    advanceSequenceSubStep(m);
    return;
  }
  m.mem.write8(DISPLAY_LATCH, m.mem8[BLANKING_VALUE], LATCH_WRITE_OFFSET);
  m.mem8[TAMPER_WITNESS] = m.mem8[SAMPLED_CELL];
  m.mem8[TAMPER_WITNESS + 1] = m.mem8[SAMPLED_CELL];
}

/** BUG: the failure arm never switches the display off — visible only in the device writes. */
function brokenFailureLeavesPictureOn(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total === EXPECTED_TOTAL) {
    advanceSequenceSubStep(m);
    return;
  }
  m.mem8[TAMPER_WITNESS] = m.mem8[SAMPLED_CELL];
  m.mem8[TAMPER_WITNESS + 1] = m.mem8[SAMPLED_CELL & ~CHARACTER_PLANE_BIT];
}

/** BUG: the failure arm ALSO steps the sequence, so a tampered image carries on running. */
function brokenFailureAlsoAdvances(m) {
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  if (total !== EXPECTED_TOTAL) failureArm(m);
  advanceSequenceSubStep(m);
}

/**
 * Per twin: whether the genuine image catches it, and whether the altered one does. A twin that
 * only mis-reads the guarded block cannot be seen on the ALTERED image, because both it and the
 * routine take the failure arm there; a twin that only breaks the failure arm cannot be seen on
 * the genuine one. Neither is a gap — between them the two columns cover both arms, and a twin
 * blind in BOTH would fail the assertion below.
 */
const TWINS = [
  ["no-op", brokenNoOp, true, true],
  ["block-off-by-one", brokenBlockOffByOne, true, false],
  ["one-byte-short", brokenOneByteShort, true, false],
  ["no-wrap", brokenNoWrap, true, false],
  ["expected-off-by-one", brokenExpectedOffByOne, true, true],
  ["inverted-guard", brokenInverted, true, true],
  ["no-advance", brokenNoAdvance, true, false],
  ["failure-copies-glyph-twice", brokenFailureCopiesGlyphTwice, false, true],
  ["failure-also-advances", brokenFailureAlsoAdvances, false, true],
  ["failure-leaves-picture-on", brokenFailureLeavesPictureOn, false, true],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: guardBlockOrBlankDisplay == oracle on RAM", { skip }, () => {
  const r = gate(guardBlockOrBlankDisplay);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  console.log(`  EQUAL: the one real dispatch replays identically`);
});

test("NOT VACUOUS: a no-op candidate FAILS the RAM diff at the real dispatch", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the RAM diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: the registers that move, on both arms", { skip }, () => {
  const moved = new Set();
  for (const machine of [entryState(), altered()]) {
    const a = machine.clone();
    const b = a.clone();
    b.mem.rom = a.mem.rom;
    oracle(a);
    guardBlockOrBlankDisplay(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  const movedList = REG_FIELDS.filter((k) => moved.has(k));
  console.log(`  EXCLUDED (measured): ${movedList.join(", ")}`);
  const unexpected = movedList.filter((k) => !MOVED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
});

test("TAPE REACH: exactly one session reaches this entry, once", { skip }, () => {
  const seen = sessions();
  console.log(`  TAPE REACH (measured): ${seen.map((s) => `${s.label} ${s.dispatches}`).join(", ")}`);
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  assert.ok(seen.some((s) => s.dispatches > 0), "vacuous: no session reaches the routine at all");
});

test("CORPUS: that dispatch replays identically", { skip }, () => {
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
  }
  console.log("  CORPUS: the one real dispatch is identical");
});

test("THE TOTAL: read back from the image, and what the comparison wants", { skip }, () => {
  const m = entryState();
  let total = m.mem8[TOTAL_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = (total + m.mem8[GUARDED_FIRST + i]) & 0xff;
  console.log(`  THE TOTAL: the image gives ${total}, the comparison wants ${EXPECTED_TOTAL}`);
  assert.equal(total, EXPECTED_TOTAL, "the guarded block no longer adds up, so a genuine image " +
    "takes the FAILURE arm and every arm in this file describes the wrong path");
});

test("FAILURE ARM: an altered image takes it, and both sides agree there", { skip }, () => {
  const before = altered();
  const a = before.clone();
  a.mem.rom = before.mem.rom;
  const b = before.clone();
  b.mem.rom = before.mem.rom;
  oracle(a);
  guardBlockOrBlankDisplay(b);

  const changed = [];
  const da = before.dumpState();
  const db = a.dumpState();
  for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) changed.push(a.stateOffsetToAddr(i));
  console.log(`  FAILURE ARM: writes ${changed.map(hex4).join(" ")}`);
  assert.deepEqual(changed, [TAMPER_WITNESS, TAMPER_WITNESS + 1], "the failure arm's write set moved");
  assert.equal(a.mem8[TAMPER_WITNESS], SAMPLE_GLYPH, "the glyph is not what was copied");
  assert.equal(a.mem8[TAMPER_WITNESS + 1], SAMPLE_COLOUR, "the colour is not what was copied");
  assert.equal(a.mem8[SEQUENCE_SUBSTEP], before.mem8[SEQUENCE_SUBSTEP], "the failure arm must not " +
    "step the sequence");
  const d = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.equal(d, null, `the two sides disagree on the failure arm — ${show(d)}`);
});

test("THE DROPPED READ: forcing it hostile over a whole session leaves no trace", { skip }, () => {
  const hostile = wholeRun((mm) => {
    const r = oracle(mm);
    mm.regs.c = 0x5a;
    return r;
  });
  assert.equal(hostile.threw, null, `the run stopped: ${hostile.threw}`);
  assert.ok(hostile.fired > 0, "vacuous: the instrument never reached the routine");
  assert.deepEqual(hostile.cells, [], "the register the rewrite does not load reached game " +
    "memory, so some caller CONSUMES it and dropping the read is wrong");

  // The tooth on the instrument: a change the routine's own effect DOES carry forks the run.
  const control = wholeRun((mm) => {
    const r = oracle(mm);
    mm.mem8[SEQUENCE_SUBSTEP] = mm.mem8[SEQUENCE_SUBSTEP] + 1;
    return r;
  });
  console.log(
    `  DROPPED READ: ${hostile.fired} dispatches, no trace; the control forks ` +
      `${control.cells.length} cells`,
  );
  assert.ok(control.cells.length > 0 || control.threw !== null, "nudging the ONE cell this " +
    "routine writes also left no trace, so the instrument reaches nothing and the arm above " +
    "proves nothing");
});

test("WHOLE-MACHINE: an undriven session is byte-identical with the rewrite wired", { skip }, () => {
  const r = wholeRun(hosted(guardBlockOrBlankDisplay));
  console.log(`  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, ${r.cells.length} cells differ`);
  assert.equal(r.threw, null, `the run stopped: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, [], "this routine touches no stack, so a whole run must be identical");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, genuineCatches, alteredCatches] of TWINS) {
  test(`TEETH: the ${label} twin, on the genuine image and on an altered one`, { skip }, () => {
    const genuine = unitDiff(twin, entryState()) !== null;
    const onAltered = alteredDiff(twin) !== null;
    console.log(
      `  TEETH/${label}: genuine ${genuine ? "caught" : "BLIND"}, altered ` +
        `${onAltered ? "caught" : "BLIND"}`,
    );
    assert.equal(genuine, genuineCatches, `the ${label} twin's genuine-image verdict changed`);
    assert.equal(onAltered, alteredCatches, `the ${label} twin's altered-image verdict changed`);
    assert.ok(genuine || onAltered, `the ${label} twin is invisible to every arm here`);
  });
}
