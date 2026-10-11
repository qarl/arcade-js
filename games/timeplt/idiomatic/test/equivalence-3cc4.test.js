// SPDX-License-Identifier: GPL-3.0-only
/**
 * hasReachedBoundaryBandSelectedByHeading — memory-equivalent to the frozen oracle at ROM 0x3CC4.
 *
 * GATE: strict unit-capture with NO exclusion — the frozen routine pushes nothing and writes
 *   nothing — plus a live-out comparison of the returned boolean against the oracle's carry, a sweep that
 *   is exhaustive over the routine's whole input space by decomposition, a captured real corpus
 *   from three sessions, a whole-machine replay, and teeth.
 *
 *   THE ANSWER, NOT THE MEMORY, IS THE CONTRACT. No cell is written on any path, so a RAM diff
 *   alone would pass a candidate that answered the opposite every time. The BLIND arm MEASURES
 *   that rather than asserting it.
 *
 *   WHERE THE LIVE-OUT COMES FROM. It is read off the frozen routine's two call sites, not off the
 *   rewrite: ROM 0x3B77 and ROM 0x4447 each `call 0x3CC4` and immediately branch on carry, and the
 *   first instruction on every one of the four continuations loads A from memory before reading it
 *   (0x3C0D and 0x46DB open with `xor a`; 0x3CE9 with `ld a,(0xA980)`; 0x4447's fall-through with
 *   `ld a,(0xAD04)`). So carry is live and A is dead at every site, and no site tests any other
 *   flag. The excluded set below is therefore a CEILING derived from those sites — the arm asserts
 *   no register OUTSIDE it moves, and stays green on a rewrite that becomes register-exact.
 *
 *   THE ANSWER IS RETURNED, NOT LEFT IN CARRY. Both call sites belong to overrides that take the
 *   return (HAND-OFF arm: measured on the ORACLE over the tape sessions, the callers that hear F
 *   complemented at this exit are exactly CARRY_READERS, each owned by a ROUTINES entry, with the SP
 *   flip at the same exit heard). HOLE: a reader reached only in a state no session drives is not
 *   measured.
 *
 * What it exercises, holes stated:
 *   1. CONTRACT — the shared unit harness reaches the routine and RAM is identical there. The
 *      register diff that helper also returns is deliberately NOT asserted; see the ceiling below.
 *   2. EQUAL at the real dispatch — the whole dump, and the returned boolean against the carry.
 *   3. NOTHING IS WRITTEN — the frozen routine's own write-set, measured over a sample, is empty.
 *   4. RAM IS BLIND — measured with the inverted twin, so the live-out arm is known to be the only
 *      thing holding this routine to its answer.
 *   5. ARM REACH — which of the three arms real play takes, counted. One of them, the in-window
 *      answer on the coordinate this file decides itself, is taken ZERO times in every session;
 *      the same counter reporting the other two as present is the positive control for that zero.
 *   6. CORPUS — every captured dispatch of three sessions, on RAM and on the answer.
 *   7. EXCLUDED, as a CEILING — over the whole sweep, no register outside the declared set moves.
 *   8. HEADING SWEEP — all 256 headings at a coordinate pair the two arms answer differently on,
 *      so the arm choice is pinned for every heading and not just the two the corpus presents.
 *   9. PLANE SWEEP — all 65536 coordinate pairs at one heading from EACH arm. With 8 that is
 *      exhaustive over the whole input space: the arm choice is verified for every heading, and
 *      the answer for every coordinate pair within each arm.
 *  10. THE REUSED MACHINES ARE SOUND — clone-per-point whole-dump agreement on a sample, which is
 *      what says the sweep's machine reuse is not hiding a write.
 *  11. WHOLE-MACHINE — an undriven session with the rewrite wired, diffed every frame.
 *  12. TEETH — twins, each with an exact catch count over the sweep and over the real corpus.
 *      Three of them are caught by NO real dispatch and their zeros are recorded, because the
 *      in-window arm and the exact width of this file's own band are off every reachable path.
 *
 * HOLE: the corpus presents ONE sprite entry and ONE object record per session; every crafted arm
 * varies the bytes read out of them, never which record they are read from.
 * HOLE: the whole-machine arm can only see a twin that changes what a CALLER writes; it is not the
 * arm that holds this entry to its bands, the sweep arms are.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3cc4.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { TAPE_SESSIONS, handOffReaders, heardAs } from "./_deadAtExit.js";
import { ROUTINES } from "../names.js";
import { hasReachedBoundaryBandSelectedByHeading } from "../hasReachedBoundaryBandSelectedByHeading.js";
import { loc_3cc4 as oracle } from "../../translated/loc_3cc4.js";
import { unitEquivalence, wholeMachineEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS, F_C } from "../../../../core/cpu/z80.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x3cc4;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const HEADING_IN_RECORD = 2;
const FIRST_COORDINATE = 0x00;
const SECOND_COORDINATE = 0x31;

/** The band this file decides itself, the band it hands to, and the other coordinate's. */
const LOCAL_BAND = 3;
const LOCAL_STARTS_BELOW_WRAP = 19;
const FAR_BAND = 3;
const FAR_STARTS_BELOW_WRAP = 16;
const FIRST_BAND = 4;
const FIRST_STARTS_BELOW_WRAP = 2;

const QUARTER_TURN = 64;
const HALF_A_TURN = 128;

/** One heading from each half of the compass, and a pair the two halves answer differently on. */
const HEADING_FAR = 100;
const HEADING_LOCAL = 0;
const SPLIT_FIRST = 0x80;
const SPLIT_SECOND = 0xf0;

const HEADINGS = 256;
const PLANE = 256 * 256;
const CROSS_CHECK_POINTS = 600;

/** Derived from the frozen routine's call sites, not from the rewrite. See the header. */
const EXCLUDED = ["a", "f", "sp"];
/** Return address of each caller that reads the carry -> the override owning that code: `call 0x3cc4`
 *  at 0x3B88 in advanceTwoTileObjectThenTryAimedSpawn (0x3B77) and at 0x4447 in
 *  dressSpriteForHeadingOrRetireAtEdge (0x4447), each followed by `jp c`. */
const CARRY_READERS = new Map([[0x3b8b, [0x3b77]], [0x444a, [0x4447]]]);
const HANDOFF_FRAMES = 2500;

const CORPUS_FRAMES = 6000;
const WHOLE_FRAMES = 1600;
const REACH_FRAMES = 1500;
const CAPTURE_CAP = 200;
const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");
const carry = (m) => (m.regs.f & F_C) !== 0;
const inWindow = (v, below, band) => u8(v + below) < band;
const takesTheFarArm = (heading) => u8(heading + QUARTER_TURN) >= HALF_A_TURN;

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let i = 0; i < 40; i++) {
    tape.push({ frame, port: IN1, bits: compass[i % compass.length], dur: TURN_HOLD });
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

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { attract: 997, shared: 673, turning: 515 };
/** Which arm those dispatches take, summed over the three sessions. Measured. */
const ARMS = { far: 1505, inWindow: 0, other: 680 };

// ── capturing real dispatches ───────────────────────────────────────────────────────────

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

/** The whole dump, then the returned boolean against the carry the oracle answers in. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  const returned = candidate(b);
  const ram = allDiffs(a, b)[0];
  if (ram) return ram;
  if (returned !== carry(a)) return { addr: null, a: carry(a), b: returned };
  return null;
}

function captureSession(factory) {
  let dispatches = 0;
  const entries = [];
  const arms = { far: 0, inWindow: 0, other: 0 };
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      const heading = mm.mem8[u16(mm.regs.ix + HEADING_IN_RECORD)];
      const second = mm.mem8[u16(mm.regs.iy + SECOND_COORDINATE)];
      if (takesTheFarArm(heading)) arms.far++;
      else if (inWindow(second, LOCAL_STARTS_BELOW_WRAP, LOCAL_BAND)) arms.inWindow++;
      else arms.other++;
      if (entries.length < CAPTURE_CAP) entries.push(mm.clone());
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, entries, arms };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...captureSession(factory) }));
  }
  return sessionCache;
}

const entryState = () => sessions()[0].entries[0];

function corpusCaught(candidate) {
  return sessions().map((s) => s.entries.filter((e) => unitDiff(candidate, e) !== null).length);
}

// ── the sweep, on two reused machines ───────────────────────────────────────────────────

let arena = null;
function pair() {
  if (!arena) arena = [entryState().clone(), entryState().clone()];
  return arena;
}

/**
 * One point. Both machines are reset to the same heading, coordinates and stack pointer before
 * each run, which is sound here BECAUSE nothing is written — a claim the cross-check arm tests
 * rather than takes on trust.
 */
function answerDiffers(candidate, heading, first, second) {
  const [a, b] = pair();
  const seat = entryState();
  for (const m of [a, b]) {
    m.regs.ix = seat.regs.ix;
    m.regs.iy = seat.regs.iy;
    m.regs.sp = seat.regs.sp;
    m.regs.f = seat.regs.f;
    m.mem8[u16(seat.regs.ix + HEADING_IN_RECORD)] = heading;
    m.mem8[u16(seat.regs.iy + FIRST_COORDINATE)] = first;
    m.mem8[u16(seat.regs.iy + SECOND_COORDINATE)] = second;
  }
  oracle(a);
  return candidate(b) !== carry(a);
}

function headingSweepCaught(candidate) {
  let caught = 0;
  for (let h = 0; h < HEADINGS; h++) {
    if (answerDiffers(candidate, h, SPLIT_FIRST, SPLIT_SECOND)) caught++;
  }
  return caught;
}

function planeSweepCaught(candidate, heading) {
  let caught = 0;
  for (let first = 0; first < 256; first++) {
    for (let second = 0; second < 256; second++) {
      if (answerDiffers(candidate, heading, first, second)) caught++;
    }
  }
  return caught;
}

const sweepCaught = (candidate) =>
  headingSweepCaught(candidate) +
  planeSweepCaught(candidate, HEADING_FAR) +
  planeSweepCaught(candidate, HEADING_LOCAL);

// ── the whole-machine replay ────────────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    // The frozen caller branches on carry; seat the return there, as the overrides take it.
    mm.regs.fC = candidate(mm) === true;
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

const replay = (candidate) =>
  wholeMachineEquivalence(attractMachine, WHOLE_FRAMES, new Map([[TARGET, hosted(candidate)]]));

// ── the twins ───────────────────────────────────────────────────────────────────────────

const reading = (m) => [
  m.mem8[u16(m.regs.ix + HEADING_IN_RECORD)],
  m.mem8[u16(m.regs.iy + FIRST_COORDINATE)],
  m.mem8[u16(m.regs.iy + SECOND_COORDINATE)],
];

const farArm = (first, second) =>
  inWindow(second, FAR_STARTS_BELOW_WRAP, FAR_BAND) ||
  inWindow(first, FIRST_STARTS_BELOW_WRAP, FIRST_BAND);
const localArm = (first, second) =>
  inWindow(second, LOCAL_STARTS_BELOW_WRAP, LOCAL_BAND) ||
  inWindow(first, FIRST_STARTS_BELOW_WRAP, FIRST_BAND);
const answerOf = (heading, first, second) =>
  takesTheFarArm(heading) ? farArm(first, second) : localArm(first, second);

/** BUG: does nothing at all, so it answers nothing. */
function brokenNoOp() {}

/** BUG: the answer is always the opposite. */
function brokenInverted(m) {
  const [h, f, s] = reading(m);
  return (!answerOf(h, f, s));
}

/** BUG: the heading is ignored and the far band is always taken. */
function brokenAlwaysFar(m) {
  const [, f, s] = reading(m);
  return (farArm(f, s));
}

/** BUG: the heading is ignored and this file's own band is always taken. */
function brokenAlwaysLocal(m) {
  const [, f, s] = reading(m);
  return (localArm(f, s));
}

/** BUG: the two halves of the compass choose each other's band. */
function brokenArmsSwapped(m) {
  const [h, f, s] = reading(m);
  return (takesTheFarArm(h) ? localArm(f, s) : farArm(f, s));
}

/** BUG: the heading is split on its own top bit, with no quarter turn first. */
function brokenUnbiasedHeading(m) {
  const [h, f, s] = reading(m);
  return (h >= HALF_A_TURN ? farArm(f, s) : localArm(f, s));
}

/** BUG: this file's band sits where the far one does, so both halves ask the same question. */
function brokenBandsCoincide(m) {
  const [h, f, s] = reading(m);
  return (takesTheFarArm(h) ? farArm(f, s) : farArm(f, s));
}

/** BUG: this file's band is one wider. */
function brokenBandTooWide(m) {
  const [h, f, s] = reading(m);
  if (takesTheFarArm(h)) return (farArm(f, s));
  const arrived = inWindow(s, LOCAL_STARTS_BELOW_WRAP, LOCAL_BAND + 1);
  return (arrived || inWindow(f, FIRST_STARTS_BELOW_WRAP, FIRST_BAND));
}

/** BUG: this file's arm never hands the question on to the other coordinate. */
function brokenDropsTheOtherCoordinate(m) {
  const [h, f, s] = reading(m);
  if (takesTheFarArm(h)) return (farArm(f, s));
  return (inWindow(s, LOCAL_STARTS_BELOW_WRAP, LOCAL_BAND));
}

const TWINS = [
  ["no-op", brokenNoOp, 131328, [200, 200, 200]],
  ["inverted", brokenInverted, 131328, [200, 200, 200]],
  ["always-far", brokenAlwaysFar, 1640, [3, 3, 3]],
  ["always-local", brokenAlwaysLocal, 1640, [0, 0, 0]],
  ["arms-swapped", brokenArmsSwapped, 3280, [3, 3, 3]],
  ["unbiased-heading", brokenUnbiasedHeading, 1640, [0, 0, 0]],
  ["bands-coincide", brokenBandsCoincide, 1640, [3, 3, 3]],
  ["band-too-wide", brokenBandTooWide, 380, [1, 1, 1]],
  ["drops-the-other-coordinate", brokenDropsTheOtherCoordinate, 1012, [0, 0, 0]],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: the shared unit harness reaches the routine and RAM is identical", { skip }, () => {
  const r = unitEquivalence(attractMachine, TARGET, oracle, hasReachedBoundaryBandSelectedByHeading, { maxFrames: REACH_FRAMES });
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  console.log(`  CONTRACT: reached within ${REACH_FRAMES} frames; RAM identical`);
});

test("EQUAL at the real dispatch: the whole dump, and the returned boolean is the carry", { skip }, () => {
  const seen = sessions();
  assert.ok(seen[0].entries.length > 0, "vacuous: the undriven session never reached the routine");
  const e = entryState();
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  const returned = hasReachedBoundaryBandSelectedByHeading(b);
  assert.deepEqual(allDiffs(a, b), [], `a byte diverged — ${show(allDiffs(a, b)[0])}`);
  assert.equal(returned, carry(a), "the returned boolean disagrees with the oracle's carry");
  const [h, f, s] = reading(e);
  console.log(
    `  EQUAL: record ${hex4(e.regs.ix)} entry ${hex4(e.regs.iy)} heading ${h} first ${f} ` +
      `second ${s}; answer ${carry(a)}`,
  );
});

test("NOTHING IS WRITTEN: the frozen routine's own write-set is empty", { skip }, () => {
  let touched = 0;
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const before = entryState().clone();
    const after = before.clone();
    after.mem8[u16(after.regs.ix + HEADING_IN_RECORD)] = (i * 61) & 0xff;
    after.mem8[u16(after.regs.iy + FIRST_COORDINATE)] = (i * 37) & 0xff;
    after.mem8[u16(after.regs.iy + SECOND_COORDINATE)] = (i * 53) & 0xff;
    const seed = after.clone();
    oracle(after);
    touched += allDiffs(seed, after).length;
  }
  assert.equal(touched, 0, "the frozen routine writes a cell after all, so the sweep's machine " +
    "reuse is unsound and every count in this file has to be re-derived");
  console.log(`  NOTHING IS WRITTEN: ${CROSS_CHECK_POINTS} points, no cell moved`);
});

test("RAM IS BLIND: an always-wrong candidate leaves the dump identical", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  const answer = brokenInverted(b);
  assert.deepEqual(allDiffs(a, b), [], "the inverted twin now moves a byte, so RAM is no longer " +
    "blind here and this file's account of what the gate rests on must be re-derived");
  assert.notEqual(answer, carry(a), "the inverted twin must differ where RAM cannot see");
  console.log("  RAM IS BLIND: the inverted twin is dump-identical; only the answer separates them");
});

test("ARM REACH: two arms are taken by real play and the third by none", { skip }, () => {
  const seen = sessions();
  const total = { far: 0, inWindow: 0, other: 0 };
  for (const s of seen) for (const k of Object.keys(total)) total[k] += s.arms[k];
  console.log(
    `  ARM REACH (measured): ${seen.map((s) => `${s.label} ${s.dispatches}`).join(", ")}; arms ` +
      `far ${total.far} / in-window ${total.inWindow} / handed-on ${total.other}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  assert.deepEqual(total, ARMS, "the arm split moved");
  // POSITIVE CONTROL for the zero: the same counter, on the same runs, reports the other two arms
  // present in the hundreds. An instrument that could not see an arm would report all three zero.
  assert.ok(total.far > 0 && total.other > 0, "the arm counter sees nothing at all, so its zero " +
    "for the in-window arm is uninformative");
  assert.equal(total.inWindow, 0, "real play now reaches the in-window arm, so it is no longer a " +
    "crafted-only arm and this file's account of its coverage must change");
});

test("CORPUS: every captured dispatch of three sessions is identical", { skip }, () => {
  const caught = corpusCaught(hasReachedBoundaryBandSelectedByHeading);
  const captured = sessions().map((s) => s.entries.length);
  console.log(`  CORPUS: ${captured.join("/")} captured dispatches, RAM and the answer identical`);
  assert.deepEqual(caught, [0, 0, 0], "the rewrite diverged on a real dispatch");
  assert.ok(captured.reduce((n, c) => n + c, 0) > 0, "vacuous: nothing was captured");
});

test("EXCLUDED, as a CEILING: no register outside the declared set moves", { skip }, () => {
  const moved = new Set();
  const points = [];
  for (let h = 0; h < HEADINGS; h += 17) {
    for (const first of [0, 1, 0xfe, 0xff, 0x80]) {
      for (const second of [0, 0xec, 0xed, 0xef, 0xf0, 0xf2, 0xff]) points.push([h, first, second]);
    }
  }
  for (const [h, first, second] of points) {
    const a = entryState().clone();
    a.mem8[u16(a.regs.ix + HEADING_IN_RECORD)] = h;
    a.mem8[u16(a.regs.iy + FIRST_COORDINATE)] = first;
    a.mem8[u16(a.regs.iy + SECOND_COORDINATE)] = second;
    const b = a.clone();
    oracle(a);
    hasReachedBoundaryBandSelectedByHeading(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  const strays = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  console.log(
    `  EXCLUDED (measured over ${points.length} points): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}` +
      `; ceiling ${EXCLUDED.join(", ")}`,
  );
  assert.deepEqual(strays, [], "a register outside the declared ceiling diverged");
});

test("HEADING SWEEP: all 256 headings choose the same arm", { skip }, () => {
  assert.notEqual(
    farArm(SPLIT_FIRST, SPLIT_SECOND),
    localArm(SPLIT_FIRST, SPLIT_SECOND),
    "the sweep's coordinate pair no longer separates the two arms, so this arm proves nothing",
  );
  assert.equal(headingSweepCaught(hasReachedBoundaryBandSelectedByHeading), 0, "the rewrite chose a different arm somewhere");
  console.log(`  HEADING SWEEP: ${HEADINGS} headings, on a pair the two arms disagree about`);
});

test("PLANE SWEEP: all 65536 coordinate pairs, on a heading from EACH arm", { skip }, () => {
  for (const heading of [HEADING_FAR, HEADING_LOCAL]) {
    assert.equal(planeSweepCaught(hasReachedBoundaryBandSelectedByHeading, heading), 0, `diverged somewhere at heading ${heading}`);
  }
  console.log(`  PLANE SWEEP: ${2 * PLANE} pairs across the two arms, the return equal to the carry`);
});

test("HAND-OFF: every caller that reads the carry is an override that takes the return", { skip }, () => {
  const { callers, readers, exitControl } = handOffReaders({
    at: TARGET, poison: ["f"], sessions: TAPE_SESSIONS, frames: HANDOFF_FRAMES,
  });
  assert.ok(callers.size > 0, "vacuous: no session dispatched the boundary test");
  assert.deepEqual([...readers.keys()].sort((p, q) => p - q), [...CARRY_READERS.keys()],
    "the set of callers that read the oracle's carry moved -- a new reader needs its override checked");
  for (const [ret, owners] of CARRY_READERS) {
    const served = owners.filter((addr) => ROUTINES[addr] !== undefined);
    assert.deepEqual(served, owners, `the reader after ${hex4(ret)} is not served by an override`);
  }
  console.log(`  HAND-OFF: ${callers.size} callers, F heard at ` +
    `${[...readers].map(([r, w]) => `${hex4(r)} (${w})`).join(" ")}, each served by an override; ` +
    `exit control heard (${heardAs(exitControl)})`);
});

test("THE REUSED MACHINES ARE SOUND: clone-per-point agrees on a sample", { skip }, () => {
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const heading = (i * 29) & 0xff;
    const first = (i * 37) & 0xff;
    const second = (i * 53) & 0xff;
    const m = entryState().clone();
    m.mem8[u16(m.regs.ix + HEADING_IN_RECORD)] = heading;
    m.mem8[u16(m.regs.iy + FIRST_COORDINATE)] = first;
    m.mem8[u16(m.regs.iy + SECOND_COORDINATE)] = second;
    assert.equal(unitDiff(hasReachedBoundaryBandSelectedByHeading, m), null, `clone-per-point diverged at ${heading},${first},${second}`);
    assert.equal(
      answerDiffers(hasReachedBoundaryBandSelectedByHeading, heading, first, second),
      false,
      `the reused arena disagrees with clone-per-point at ${heading},${first},${second}`,
    );
  }
  console.log(`  SOUND: ${CROSS_CHECK_POINTS} points agree between the arena and clone-per-point`);
});

test("WHOLE-MACHINE: an undriven session is byte-identical with the rewrite wired", { skip }, () => {
  const w = replay(hasReachedBoundaryBandSelectedByHeading);
  assert.ok(w.invocations.get(TARGET) > 0, "vacuous: the override never dispatched");
  assert.equal(w.framesCompared, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.equal(w.equal, true, `forked at frame ${w.frame} on ${hex4(w.addr ?? 0)}`);
  console.log(
    `  WHOLE-MACHINE: ${w.framesCompared} frames, ${w.invocations.get(TARGET)} dispatches, identical`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, sweep, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of sweep points`, { skip }, () => {
    const caught = sweepCaught(twin);
    console.log(`  TEETH/${label}: caught on ${caught} of ${HEADINGS + 2 * PLANE} sweep points`);
    assert.equal(caught, sweep, `the ${label} twin's sweep catch count moved`);
    assert.ok(caught > 0, `the sweep missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin's real-dispatch catch count, zeros recorded`, { skip }, () => {
    const caught = corpusCaught(twin);
    const blind = caught.every((n) => n === 0);
    console.log(
      `  TEETH/${label}: real sessions catch ${caught.join("/")}` +
        (blind ? " — caught by NO real dispatch, as recorded" : ""),
    );
    assert.deepEqual(caught, perSession, `the ${label} twin's real-dispatch counts moved`);
  });
}
