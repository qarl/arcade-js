// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroyEraObjectsAndPlayerOnContact — memory-equivalent to the frozen oracle at ROM 0x5121.
 *
 * WHAT IT IS. A sweep of a caller's run of target slots against ONE attacker whose state byte and
 * two screen coordinates live at fixed cells. Every hit destroys the target and the attacker and
 * posts the chained hit score through the already-decompiled postChainedHitScore, so that transfer
 * is dissolved into a direct call here.
 *
 * ★ THE ATTACKER'S STATE IS TESTED ONCE, AT THE TOP, AND NEVER AGAIN. So a sweep that lands one hit
 *   keeps going and can land more, each one paying the score again. That is behaviour and not an
 *   oversight, and the multi-hit twin — one that stops at the first — is the tooth that holds it.
 *
 * ★ THE TWO CURSORS ARE LIVE-OUTS. The caller that follows this one reloads the count and the box
 *   but NOT the record cursor or the entry cursor, so both must come back advanced. They are
 *   compared alongside RAM on every arm, and the cursors-held twin is caught by that comparison
 *   alone.
 *
 * ★ THE RECORD CURSOR STAYS INSIDE ITS PAGE. The stride is added to the low half only, so a run
 *   that would cross a page boundary wraps onto the head of the same page instead. The crafted
 *   arms include a cursor placed so the run does cross, and the carrying twin is caught only there.
 *
 * GATE: strict unit-capture with one measured exclusion, three replayed sessions at every
 *   dispatch, a crafted cross over the attacker's state, the box and the cursor, and a whole-run
 *   masked diff. Holes stated:
 *
 *   1. EQUAL at the real dispatch — identical outside the scratch window; both cursors checked.
 *   2. NOT VACUOUS — a no-op FAILS the same masked diff.
 *   3. EXCLUDED — the registers that move over the whole cross, pinned.
 *   4. UNIFORM CORPUS — which sessions reach it, how often the attacker is live, and how many
 *      dispatches actually land a hit. That last number is what says whether the corpus can see
 *      the hit path at all.
 *   5. CORPUS — every dispatch of three sessions.
 *   6. CRAFTED CROSS — attacker state x box x page-crossing cursor x how much of the position
 *      coincides (both axes, neither, or exactly one), poked identically on both sides. The
 *      one-axis cases are what separate a sweep that tests both axes from one that tests either.
 *   7. WHOLE-MACHINE — a driven session with the rewrite wired, diffed every frame under the
 *      scratch mask.
 *   8. TEETH — nine twins, each with an exact catch count over the cross, per session, and a
 *      whole-run verdict. Eight of the nine are BLIND to the whole run, because no real dispatch
 *      in a driven session ever lands a hit; the corpus arm measures that, and the crafted cross
 *      is what holds them.
 *
 * HOLE: the crafted arms move the attacker onto the targets rather than the targets onto the
 * attacker, and they use one target run. A run of a different length is covered only by whatever
 * the sessions present.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-5121.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { destroyEraObjectsAndPlayerOnContact } from "../destroyEraObjectsAndPlayerOnContact.js";
import { postChainedHitScore } from "../postChainedHitScore.js";
import { loc_5121 as oracle } from "../../translated/loc_5121.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { PLAYER_STATE } from "../names.js";

const TARGET = 0x5121;

const STATE = 0;
const LIVE = 255;
const DESTROYED = 240;
const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;
const ENTRY_SECOND_AXIS = 49;
const ATTACKER_ENTRY = 0xaa10;

/** Measured: the oracle brackets its call to the scoring routine, which brackets its own. */
const SCRATCH_BYTES = 8;

const MOVED = ["a", "f", "b", "sp"];
const LIVE_OUT = ["de", "iy"];

const CORPUS_FRAMES = 2000;
const WHOLE_FRAMES = 1400;
const RET_TSTATES = 10;

const STACK_FLOOR = 0xafc0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [];

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
const DISPATCHES = { shared: 300, attract: 0, turning: 412 };

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
  if (entry === null) gate(destroyEraObjectsAndPlayerOnContact);
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

/** Oracle vs candidate on clones: masked RAM, then the two cursors the caller carries on with. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/**
 * A real captured machine with the attacker's state and position forced, the box forced, and
 * every target of the run given a state and a position. `coincident` puts the attacker exactly on
 * the targets, which is the only way to reach the hit path deterministically.
 */
function craft(p) {
  const m = entryState().clone();
  m.mem8[PLAYER_STATE] = p.attacker;
  m.regs.l = p.reach;
  m.regs.h = p.span;
  if (p.recordCursor !== undefined) m.regs.de = p.recordCursor;
  let record = m.regs.de;
  let cursor = m.regs.iy;
  for (let i = 0; i < m.regs.b; i++) {
    m.mem8[record + STATE] = p.targets;
    const firstMatches = p.coincident === true || p.coincident === "first";
    const secondMatches = p.coincident === true || p.coincident === "second";
    m.mem8[cursor] = firstMatches ? m.mem8[ATTACKER_ENTRY] : (17 * i + 3) & 0xff;
    m.mem8[cursor + ENTRY_SECOND_AXIS] = secondMatches
      ? m.mem8[ATTACKER_ENTRY + ENTRY_SECOND_AXIS]
      : (29 * i + 5) & 0xff;
    record = (record & 0xff00) | ((record + RECORD_STRIDE) & 0xff);
    cursor = (cursor + ENTRY_STRIDE) & 0xffff;
  }
  return m;
}

/** A cursor placed so the run's stride carries out of the low half and wraps inside the page. */
const pageCrossing = () => (entryState().regs.de & 0xff00) | 0xf8;

function priors() {
  const out = [];
  for (const attacker of [LIVE, DESTROYED, 0]) {
    for (const targets of [LIVE, DESTROYED, 0]) {
      for (const coincident of [true, false, "first", "second"]) {
        for (const [reach, span] of [[6, 13], [0, 1], [8, 17], [255, 255], [0, 0]]) {
          out.push({ attacker, targets, coincident, reach, span });
          out.push({ attacker, targets, coincident, reach, span, recordCursor: pageCrossing() });
        }
      }
    }
  }
  return out;
}

let crossCache = null;
function cross() {
  if (!crossCache) crossCache = priors();
  return crossCache;
}

// ── replaying whole sessions ────────────────────────────────────────────────────────────

function replaySession(factory, candidate) {
  let dispatches = 0;
  let caught = 0;
  let armed = 0;
  let hits = 0;
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      if (mm.mem8[PLAYER_STATE] === LIVE) armed++;
      const probe = mm.clone();
      oracle(probe);
      if (probe.mem8[PLAYER_STATE] === DESTROYED && mm.mem8[PLAYER_STATE] !== DESTROYED) hits++;
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, armed, hits };
}

let sessionCache = null;
function sessions() {
  if (sessionCache) return sessionCache;
  sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...replaySession(factory, destroyEraObjectsAndPlayerOnContact) }));
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
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const u8 = (x) => x & 0xff;
const within = (a, b, reach, span) => u8(u8(a - b) + reach) < span;
const nextRecord = (c) => (c & 0xff00) | u8(c + RECORD_STRIDE);

function brokenNoOp() {}

/** The correct sweep, so each twin below breaks ONE decision. */
function sweep(m, opts) {
  const { mem8, regs } = m;
  if (!opts.skipGuard && mem8[PLAYER_STATE] !== LIVE) return;
  let record = regs.de;
  let cursor = regs.iy;
  let left = regs.b;
  do {
    const reached =
      mem8[record + STATE] === LIVE &&
      (opts.firstAxisOnly ||
        within(mem8[ATTACKER_ENTRY], mem8[cursor], regs.l, regs.h)) &&
      (opts.secondAxisOnly ||
        within(
          mem8[ATTACKER_ENTRY + ENTRY_SECOND_AXIS],
          mem8[cursor + ENTRY_SECOND_AXIS],
          regs.l,
          regs.h,
        ));
    if (reached && !(opts.stopAtFirst && mem8[PLAYER_STATE] !== LIVE)) {
      mem8[PLAYER_STATE] = DESTROYED;
      mem8[record + STATE] = DESTROYED;
      if (!opts.noScore) postChainedHitScore(m);
    }
    cursor = (cursor + (opts.entryStride ?? ENTRY_STRIDE)) & 0xffff;
    record = opts.carryingCursor ? (record + RECORD_STRIDE) & 0xffff : nextRecord(record);
    left = u8(left - 1);
  } while (left !== 0);
  if (!opts.cursorsHeld) {
    regs.de = record;
    regs.iy = cursor;
  }
}

const twin = (opts) => (m) => sweep(m, opts);

/**
 * Per twin: its catch count over the crafted cross, its catch count in each session, and whether
 * the whole run sees it. Only the guard twin reaches the whole run, because in a real driven
 * session the sweep never lands a hit — the corpus arm measures that directly — so the crafted
 * cross is what holds every twin that breaks the hit path.
 */
const TWINS = [
  ["no-op", brokenNoOp, 120, [118, 0, 321], false],
  ["guard-skipped", twin({ skipGuard: true }), 240, [182, 0, 91], true],
  ["first-axis-only", twin({ firstAxisOnly: true }), 8, [0, 0, 13], false],
  ["second-axis-only", twin({ secondAxisOnly: true }), 8, [0, 0, 17], false],
  ["stops-at-first", twin({ stopAtFirst: true }), 8, [0, 0, 0], false],
  ["no-score", twin({ noScore: true }), 8, [0, 0, 0], false],
  ["cursors-held", twin({ cursorsHeld: true }), 120, [118, 0, 321], false],
  ["carrying-cursor", twin({ carryingCursor: true }), 60, [0, 0, 0], false],
  ["wrong-entry-stride", twin({ entryStride: 1 }), 120, [118, 0, 321], false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  gate(destroyEraObjectsAndPlayerOnContact);
  assert.notEqual(entry, null, "vacuous: the session never reached the routine");
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  destroyEraObjectsAndPlayerOnContact(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: entry attacker ${e.mem8[PLAYER_STATE]} run ${e.regs.b} box ${e.regs.l}/${e.regs.h} ` +
      `sp ${hex4(sp)}; ${all.length} differing bytes, ${strays.length} outside`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  for (const k of LIVE_OUT) assert.equal(a.regs[k], b.regs[k], `the ${k} cursor left behind`);
});

test("NOT VACUOUS: a no-op candidate FAILS, on the cursors here and on cells elsewhere", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  // AT THE CAPTURED ENTRY THE SWEEP WRITES NOTHING — no target is reached — so it is the two
  // cursors that catch the empty candidate there. The crafted cross is what catches it on cells.
  assert.equal(d.addr, null, "the no-op is now caught on a CELL at this entry, so the entry is no " +
    "longer the miss-every-target one this file records");
  const onCells = cross().filter((p) => (unitDiff(brokenNoOp, craft(p))?.addr ?? null) !== null);
  assert.ok(onCells.length > 0, "no crafted entry catches the no-op on a cell, so RAM is not part " +
    "of this gate at all");
  console.log(
    `  NOT VACUOUS: caught on the cursors at the real entry, and on a cell in ${onCells.length} of ` +
      `${cross().length} crafted entries`,
  );
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const p of cross()) {
    const a = craft(p);
    const b = a.clone();
    oracle(a);
    destroyEraObjectsAndPlayerOnContact(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
    for (const k of LIVE_OUT) assert.equal(a.regs[k], b.regs[k], `live-out ${k}`);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k)), MOVED, "the excluded set changed shape");
});

test("UNIFORM CORPUS: how often the attacker is armed, and how often it hits", { skip }, () => {
  const seen = sessions();
  console.log(
    `  UNIFORM CORPUS (measured): ${seen.map((s) =>
      `${s.label} ${s.dispatches} dispatches / ${s.armed} armed / ${s.hits} hits`).join("; ")}`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  const armed = seen.reduce((n, s) => n + s.armed, 0);
  assert.ok(armed > 0, "no real dispatch arrives with the attacker live, so every session takes " +
    "the early exit and only the crafted cross exercises the sweep");
});

test("CORPUS: every dispatch of three real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches, identical outside the window`);
});

test("CRAFTED: every attacker x target x box x cursor combination is identical", { skip }, () => {
  for (const p of cross()) {
    const d = unitDiff(destroyEraObjectsAndPlayerOnContact, craft(p));
    assert.equal(d, null, `${JSON.stringify(p)}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${cross().length} entries identical`);
});

test("THE HIT PATH IS REACHED: the crafted cross destroys and scores", { skip }, () => {
  let hits = 0;
  for (const p of cross()) {
    const m = craft(p);
    const before = m.mem8[PLAYER_STATE];
    oracle(m);
    if (before === LIVE && m.mem8[PLAYER_STATE] === DESTROYED) hits++;
  }
  console.log(`  HIT PATH: ${hits} of ${cross().length} crafted entries land a hit`);
  assert.ok(hits > 0, "no crafted entry reaches the hit path, so the sweep's whole body is " +
    "untested and every twin below that breaks it is invisible");
});

test("WHOLE-MACHINE: a driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(destroyEraObjectsAndPlayerOnContact);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, cells [${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run stopped: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of dead stack bytes moved");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, candidate, crossCaught, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter((p) => unitDiff(candidate, craft(p)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = SESSIONS.map(([, factory]) => replaySession(factory, candidate));
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
    for (const [i, r] of counts.entries()) {
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${SESSIONS[i][0]} count moved`);
    }
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(candidate);
    const seen = r.threw !== null || r.cells.some((c) => !WHOLE_RUN_CELLS.includes(c));
    console.log(`  TEETH/${label}: whole machine ${seen ? `catches it (${r.threw ?? r.cells.length + " cells"})` : "is BLIND"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}
