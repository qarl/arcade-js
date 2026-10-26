// SPDX-License-Identifier: GPL-3.0-only
/**
 * driftAtHalfWorldScroll — memory-equivalent to the frozen oracle at ROM 0x2DF4.
 *
 * GATE: masked unit-capture, a real-traffic corpus from three tapes, a crafted cross, an
 *   exhaustive sweep of one displacement, and a whole-machine replay of driven play.
 *
 * ★ THE RAM DIFF MUST BE MASKED, AND THE MASK IS MEASURED, NOT ASSUMED. The oracle CALLS a
 *   helper twice, so it pushes a return address the rewrite does not; the two bytes below the
 *   entry stack pointer therefore differ for a CORRECT rewrite and `unitEquivalence`'s own
 *   `ram` is never null here. STACK SCRATCH pins the window to exactly those bytes, then earns
 *   the exclusion with two controls: the same whole-machine replay with the oracle wired moves
 *   NOTHING (so the instrument can see zero), and hostile bytes written into the window on every
 *   dispatch of a driven session drift exactly the footprint the rewrite itself drifts and no
 *   other address at all (so the window is dead scratch, and it is what makes the rewrite drift).
 *
 * ★ THE REAL DISPATCH IS FULLY DEGENERATE — worse than narrow. The first dispatch the shared
 *   tape reaches carries BOTH displacements zero, so not one of the four written bytes moves and
 *   a no-op passes the masked RAM comparison outright. DEGENERATE asserts that rather than
 *   letting it pass for coverage. Only the live-out catches a no-op there, and every arm with
 *   real teeth is the corpus, the crafted cross, the sweep or the replay.
 *
 * ★ THE SHARED TAPE IS BLIND TO HALF THE ARITHMETIC, ASSERTED IN BOTH DIRECTIONS. It presents
 *   exactly two displacement values, both non-negative and both even, so neither the sign the
 *   halving extends nor the direction it rounds is exercised anywhere in it. BLIND CORPUS
 *   asserts that the shared tape lacks the case, asserts the three tapes together DO present
 *   negative and negative-odd displacements, and then shows the sign twin and the rounding twin
 *   moving not one live cell over a whole shared-tape session while the turning tape catches both.
 *
 * LIVE-OUT is the four written bytes PLUS the moved second coordinate, which the oracle leaves
 *   in a register pair — and the reason for that pair is MEASURED rather than assumed. DROPPED
 *   corrupts it on every dispatch of a whole driven session: it reaches two further stack bytes
 *   just above the routine's entry depth and NOT ONE live cell, while the same experiment aimed
 *   at the registers the rewrite drops moves nothing at all and the control aimed at a written
 *   byte moves a live cell. So the pair is reproduced because the oracle leaves it standing and
 *   matching it is free, NOT because a caller was observed consuming it — and the stale-live-out
 *   twin is therefore caught by the unit comparison and invisible to the replay. Both halves of
 *   that are asserted, so the day a caller starts reading it this file fails and says so.
 *
 * What it exercises: EQUAL at the real dispatch; STACK SCRATCH with its two controls; DROPPED
 * with its two controls; DEGENERATE; EXCLUDED; WRITE-SET; REAL TRAFFIC over three tapes, where
 * each recorded input tuple is shown to be the WHOLE input by reproducing what the live dispatch
 * actually produced; BLIND CORPUS; CRAFTED; CARRY; EXHAUSTIVE over all 65536 row displacements;
 * WHOLE-MACHINE; BUDGET; and TEETH — ten twins, each caught by the crafted cross and by the
 * 65536-value sweep, each with its blindness at the real dispatch pinned, and each moving a live
 * cell over a whole driven session except the one DROPPED shows cannot.
 *
 * HOLE: one object slot. Every dispatch all three tapes produce arrives with the same pair of
 * record bases — asserted in REAL TRAFFIC, not assumed — so the crafted and swept arms vary the
 * values the routine reads, never the bases it reads them from.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2df4.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { driftAtHalfWorldScroll } from "../driftAtHalfWorldScroll.js";
import { loc_2df4 as oracle } from "../../translated/loc_2df4.js";
import { unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x2df4;
const skip = romsPresent() ? false : "ROM images are not assembled";

const ROW_REMAINDER = 3;
const COLUMN_REMAINDER = 5;
const SPRITE_ROW = 49;

/** Registers the rewrite may leave diverged. Dead for this routine, so it need not move them. */
const EXCLUDED = ["f", "b", "c", "d", "e", "sp"];

const WIDTH = 65536;
const NEGATIVE_FROM = WIDTH / 2;

/** Bytes below the entry stack pointer the oracle's two calls push and pop. */
const SCRATCH_BELOW = 2;
/** Bytes at and above it a session-long replay lets drift once those two are left unwritten. */
const SCRATCH_ABOVE = 2;
/** The wider stack band a dropped register may spill into, declared here and checked three ways. */
const BAND_ABOVE = 6;

/** T-states the oracle charges in total, and the part of that its own return costs. */
const ORACLE_TSTATES = 356;
const RET_TSTATES = 10;

const CORPUS_FRAMES = 1500;
const WHOLE_FRAMES = 1400;

const IN0 = 0xc300;
const IN1 = 0xc320;
const COIN = 0x01;
const START = 0x08;
const LEFT = 0x01;
const RIGHT = 0x02;
const UP = 0x04;
const DOWN = 0x08;
const FIRE = 0x10;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const hex4 = (v) => "0x" + u16(v).toString(16).padStart(4, "0");
const signed = (v) => (v << 16) >> 16;
const show = (d) => (d ? `${d.where} ${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** The four bytes the routine writes, addressed off the two record bases the caller supplies. */
const cellsOf = (m) => ({
  wholeRow: u16(m.regs.iy + SPRITE_ROW),
  fractionRow: u16(m.regs.ix + ROW_REMAINDER),
  wholeColumn: u16(m.regs.iy),
  fractionColumn: u16(m.regs.ix + COLUMN_REMAINDER),
});
const cellList = (m) => Object.values(cellsOf(m));

/** The stick walked once round the compass, so the displacement keeps changing sign. */
function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: COIN, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: START, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: FIRE, dur: CORPUS_FRAMES },
  ];
  const compass = [
    LEFT, LEFT | UP, UP, UP | RIGHT, RIGHT, RIGHT | DOWN,
    DOWN, DOWN | LEFT, LEFT, UP, RIGHT, DOWN,
  ];
  let frame = TURN_FIRST_FRAME;
  for (const bits of compass) {
    tape.push({ frame, port: IN1, bits, dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const TAPES = [
  ["shared", {}],
  ["turning", { tape: turnTape() }],
  ["attract", { tape: [] }],
];

// ── the captured entry ──────────────────────────────────────────────────────────────────────

let entry = null;

/** The contract call, with the entry state harvested off the candidate arm's clone. */
function gate(candidate) {
  return unitEquivalence(
    makeMachine,
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
  if (entry === null) gate(driftAtHalfWorldScroll);
  return entry;
}

// ── the masked comparison ───────────────────────────────────────────────────────────────────

/** Every address two machines differ on, ignoring none — the unmasked truth. */
function everyDiff(a, b) {
  const x = a.dumpState();
  const y = b.dumpState();
  const out = [];
  for (let i = 0; i < x.length; i++) {
    if (x[i] !== y[i]) out.push({ where: "ram", addr: a.stateOffsetToAddr(i), a: x[i], b: y[i] });
  }
  return out;
}

/** The window the oracle's own pushes occupy, taken from the stack pointer it was entered with. */
const inScratch = (addr, sp) => addr >= u16(sp - SCRATCH_BELOW) && addr < sp;

/**
 * RAM outside the scratch window, then the moved coordinate the oracle leaves standing. Both
 * arms run on independent clones of the same machine, so any difference is the candidate's.
 */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  for (const d of everyDiff(a, b)) if (!inScratch(d.addr, sp)) return d;
  for (const k of ["h", "l"]) {
    if (a.regs[k] !== b.regs[k]) return { where: k, addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

// ── crafted entries ─────────────────────────────────────────────────────────────────────────

/** The real entry with both displacements and all four written bytes forced. */
function craft(prior) {
  const m = entryState().clone();
  const c = cellsOf(m);
  m.mem16[WORLD_SCROLL_Y] = prior.dR;
  m.mem16[WORLD_SCROLL_X] = prior.dC;
  m.mem8[c.wholeRow] = prior.wR;
  m.mem8[c.fractionRow] = prior.fR;
  m.mem8[c.wholeColumn] = prior.wC;
  m.mem8[c.fractionColumn] = prior.fC;
  return m;
}

const craftedDiff = (candidate, prior) => unitDiff(candidate, craft(prior));

// Zero, the two values the shared tape itself presents, a fraction-only step, both sign
// extremes, and negative displacements that are and are not even.
const DISPLACEMENTS = [0x0000, 0x0001, 0x00ff, 0x0100, 0x0180, 0x7fff, 0x8000, 0xfe80, 0xff01, 0xffff];

const POSITIONS = [
  { wR: 0, fR: 0, wC: 0, fC: 0 },
  { wR: 0, fR: 255, wC: 255, fC: 0 },
  { wR: 255, fR: 255, wC: 255, fC: 255 },
  { wR: 138, fR: 203, wC: 129, fC: 88 },
  { wR: 1, fR: 1, wC: 254, fC: 254 },
];

function craftedPriors() {
  const out = [];
  for (const dR of DISPLACEMENTS) {
    for (const dC of DISPLACEMENTS) {
      for (const p of POSITIONS) out.push({ ...p, dR, dC });
    }
  }
  return out;
}

/** One fraction byte swept over its whole range, so the carry into the whole byte is hit. */
function carryPriors() {
  const out = [];
  for (let f = 0; f < 256; f++) out.push({ wR: 200, fR: f, wC: 7, fC: f, dR: 1, dC: 0xffff });
  return out;
}

// ── the real-traffic corpus ─────────────────────────────────────────────────────────────────
//
// A dispatch is recorded as the tuple the routine reads — the two record bases, the two
// displacements and the four bytes — plus what the LIVE dispatch actually produced. Replaying
// the tuple off a canonical machine and reproducing the live output is what shows the tuple is
// the whole input; a clone per dispatch is not needed once that holds.

const corpora = new Map();

function corpus(label, opts) {
  if (!corpora.has(label)) {
    const seen = new Map();
    let dispatches = 0;
    const host = makeMachine(new Map([[TARGET, (mm) => {
      dispatches++;
      const c = cellsOf(mm);
      const rec = {
        ix: mm.regs.ix, iy: mm.regs.iy,
        dR: mm.mem16[WORLD_SCROLL_Y], dC: mm.mem16[WORLD_SCROLL_X],
        wR: mm.mem8[c.wholeRow], fR: mm.mem8[c.fractionRow],
        wC: mm.mem8[c.wholeColumn], fC: mm.mem8[c.fractionColumn],
      };
      const key = [rec.ix, rec.iy, rec.dR, rec.dC, rec.wR, rec.fR, rec.wC, rec.fC].join(",");
      const r = oracle(mm);
      rec.out = [mm.mem8[c.wholeRow], mm.mem8[c.fractionRow], mm.mem8[c.wholeColumn], mm.mem8[c.fractionColumn]];
      rec.hl = mm.regs.hl;
      if (!seen.has(key)) seen.set(key, rec);
      return r;
    }]]), opts);
    const frames = host.runFrames(CORPUS_FRAMES);
    corpora.set(label, {
      records: [...seen.values()],
      dispatches,
      frames: frames.length,
      stoppedBy: host.stoppedBy,
    });
  }
  return corpora.get(label);
}

/** Seat one recorded tuple on a machine, so the routine reads exactly what it read live. */
function seat(m, rec) {
  m.regs.ix = rec.ix;
  m.regs.iy = rec.iy;
  const c = cellsOf(m);
  m.mem16[WORLD_SCROLL_Y] = rec.dR;
  m.mem16[WORLD_SCROLL_X] = rec.dC;
  m.mem8[c.wholeRow] = rec.wR;
  m.mem8[c.fractionRow] = rec.fR;
  m.mem8[c.wholeColumn] = rec.wC;
  m.mem8[c.fractionColumn] = rec.fC;
  return m;
}

const seated = (rec) => seat(entryState().clone(), rec);

function everyRecord() {
  const out = new Map();
  for (const [label, opts] of TAPES) {
    for (const rec of corpus(label, opts).records) {
      out.set([rec.ix, rec.iy, rec.dR, rec.dC, rec.wR, rec.fR, rec.wC, rec.fC].join(","), rec);
    }
  }
  return [...out.values()];
}

/** Every displacement value, either axis, any of the tapes presented. */
function displacementsOf(records) {
  const out = new Set();
  for (const rec of records) {
    out.add(rec.dR);
    out.add(rec.dC);
  }
  return [...out];
}

// ── the exhaustive sweep ────────────────────────────────────────────────────────────────────

/**
 * Two real machines reused round to round rather than cloned 65536 times, which would dominate
 * the run. Every cell either arm reads is rewritten each pass and the oracle's stack pointer is
 * re-seated, so no iteration can leak into the next.
 */
let bench = null;
function benchPair() {
  if (bench === null) {
    const a = entryState().clone();
    bench = { a, b: entryState().clone(), sp: a.regs.sp };
  }
  return bench;
}

/**
 * The value both arms carry in the live-out pair on the way IN. Seating it matters: without it
 * the pair keeps whatever the previous round left, which for a held column displacement is the
 * correct answer, and a candidate that never writes the pair goes unnoticed for the whole sweep.
 */
const LIVE_OUT_SEED = 0x1234;

function runPair(candidate, prior) {
  const { a, b, sp } = benchPair();
  a.regs.sp = sp;
  for (const m of [a, b]) {
    m.regs.hl = LIVE_OUT_SEED;
    const c = cellsOf(m);
    m.mem16[WORLD_SCROLL_Y] = prior.dR;
    m.mem16[WORLD_SCROLL_X] = prior.dC;
    m.mem8[c.wholeRow] = prior.wR;
    m.mem8[c.fractionRow] = prior.fR;
    m.mem8[c.wholeColumn] = prior.wC;
    m.mem8[c.fractionColumn] = prior.fC;
  }
  oracle(a);
  candidate(b);
  return { a, b };
}

/** The four written bytes and the moved coordinate — the whole output, once WRITE-SET holds. */
function outputDiff(candidate, prior) {
  const { a, b } = runPair(candidate, prior);
  const ca = cellsOf(a);
  const cb = cellsOf(b);
  for (const k of Object.keys(ca)) {
    if (a.mem8[ca[k]] !== b.mem8[cb[k]]) {
      return { where: k, addr: ca[k], a: a.mem8[ca[k]], b: b.mem8[cb[k]] };
    }
  }
  if (a.regs.hl !== b.regs.hl) {
    return { where: "moved", addr: null, a: a.regs.hl, b: b.regs.hl };
  }
  return null;
}

/** Every row displacement, against one real set of positions and one held column displacement. */
function sweepRowDisplacement(candidate, held) {
  const caught = [];
  for (let dR = 0; dR < WIDTH; dR++) {
    if (outputDiff(candidate, { ...held, dR })) caught.push(dR);
  }
  return caught;
}

// ── the whole-machine replay ────────────────────────────────────────────────────────────────

/** Adapt a candidate to the cycle-driven host: pay the oracle's total, then take the return. */
function hosted(candidate) {
  return (mm) => {
    candidate(mm);
    mm.tick(ORACLE_TSTATES - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

const baselines = new Map();
function baselineOf(label, opts) {
  if (!baselines.has(label)) {
    const m = makeMachine(null, opts);
    const frames = m.runFrames(WHOLE_FRAMES);
    baselines.set(label, { frames, machine: m, stoppedBy: m.stoppedBy });
  }
  return baselines.get(label);
}

/** Every address a whole driven session ever differs on, with the override wired raw. */
function replayAddrs(raw, label = "turning", opts = { tape: turnTape() }) {
  const base = baselineOf(label, opts);
  let fired = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    fired++;
    return raw(mm);
  }]]), opts);
  const floors = recordFrameFloors(m);
  const frames = m.runFrames(WHOLE_FRAMES);
  const live = new Set(liveStackDiffs(base.frames, frames, floors, (o) => base.machine.stateOffsetToAddr(o)));
  const addrs = new Set();
  const n = Math.min(base.frames.length, frames.length);
  for (let f = 0; f < n; f++) {
    const x = base.frames[f];
    const y = frames[f];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) addrs.add(base.machine.stateOffsetToAddr(o));
  }
  return {
    addrs: Object.assign([...addrs].sort((p, q) => p - q), { live }), // live: differed at/above a sample's SP
    fired,
    frames: n,
    stoppedBy: m.stoppedBy,
    baseStoppedBy: base.stoppedBy,
  };
}

const replay = (candidate, label, opts) => replayAddrs(hosted(candidate), label, opts);

function addressesAround(below, above) {
  const sp = entryState().regs.sp;
  const out = [];
  for (let i = -below; i < above; i++) out.push(u16(sp + i));
  return out.sort((p, q) => p - q);
}

/** The window a session-long replay drifts in once the oracle's pushes go unwritten. */
const scratchWindow = () => addressesAround(SCRATCH_BELOW, SCRATCH_ABOVE);

/** The whole stack band around the routine's entry depth: nothing here is a live game cell. */
const stackBand = () => addressesAround(SCRATCH_BELOW, BAND_ABOVE);

const outside = (addrs, band = scratchWindow()) => addrs.filter((a) => !band.includes(a) || addrs.live.has(a));
const liveCells = (addrs) => outside(addrs, stackBand());

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: driftAtHalfWorldScroll == oracle outside the scratch window", { skip }, () => {
  gate(driftAtHalfWorldScroll);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  const e = entryState();
  const d = unitDiff(driftAtHalfWorldScroll, e);
  assert.equal(d, null, `diverged — ${show(d)}`);
  console.log(
    `  EQUAL: entry bases ${hex4(e.regs.ix)}/${hex4(e.regs.iy)}, displacements ` +
      `${hex4(e.mem16[WORLD_SCROLL_Y])}/${hex4(e.mem16[WORLD_SCROLL_X])} within ` +
      `${ENTRY_FRAMES} frames; RAM and the moved coordinate identical`,
  );
});

test("STACK SCRATCH: the excluded window is exactly the oracle's own pushes, and it is DEAD",
  { skip },
  () => {
    const e = entryState();
    const sp = e.regs.sp;
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    driftAtHalfWorldScroll(b);
    const raw = everyDiff(a, b);
    assert.deepEqual(
      raw.map((d) => d.addr).sort((p, q) => p - q),
      [u16(sp - 2), u16(sp - 1)],
      "the unmasked unit diff is no longer just the two bytes the oracle pushes and pops — " +
        "the mask this file draws has to be re-derived before any arm below is believed",
    );

    const clean = replayAddrs(oracle);
    assert.equal(clean.baseStoppedBy, null, "the baseline session stopped early");
    assert.equal(clean.stoppedBy, null, "the control session stopped early");
    assert.equal(clean.frames, WHOLE_FRAMES, "the control replay ran short");
    assert.ok(clean.fired > 0, "vacuous: the control override never dispatched");
    assert.deepEqual(
      clean.addrs.map(hex4),
      [],
      "wiring the oracle through the replay moved a byte, so the instrument invents diffs and " +
        "the window measured below is not the rewrite's",
    );

    // Only the two bytes the rewrite leaves unwritten are scribbled. The bytes AT the entry
    // depth hold the caller's own return address and are live, so corrupting them would prove
    // nothing about the exclusion this file draws.
    const hostile = replayAddrs((mm) => {
      const at = mm.regs.sp;
      const r = oracle(mm);
      for (let i = -SCRATCH_BELOW; i < 0; i++) mm.mem8[u16(at + i)] = 0x5a + i;
      return r;
    });
    assert.ok(hostile.fired > 0, "vacuous: the hostile override never dispatched");
    assert.equal(hostile.frames, WHOLE_FRAMES, "the hostile replay ran short");
    assert.deepEqual(
      hostile.addrs.map(hex4),
      scratchWindow().map(hex4),
      "hostile bytes written into the excluded window did not produce the same footprint the " +
        "rewrite produces, so the window is not what makes the rewrite drift and excluding it " +
        "is not licensed",
    );
    console.log(
      `  STACK SCRATCH: window ${scratchWindow().map(hex4).join(" ")}; the oracle wired through ` +
        `the replay moves nothing, and ${hostile.fired} hostile writes over ${hostile.frames} ` +
        "frames reproduce the rewrite's own footprint exactly",
    );
  });

test("DROPPED: the registers the rewrite declines to reproduce steer nothing, the moved " +
  "coordinate reaches only dead stack, and the instrument proves it could have seen otherwise",
  { skip },
  () => {
    const dead = replayAddrs((mm) => {
      const r = oracle(mm);
      mm.regs.d = 0x5a;
      mm.regs.e = 0xa5;
      mm.regs.b = 0x3c;
      mm.regs.c = 0xc3;
      mm.regs.f = 0xff;
      return r;
    });
    assert.ok(dead.fired > 0, "vacuous: the hostile session never dispatched the routine");
    assert.equal(dead.frames, WHOLE_FRAMES, "the hostile session ran short");
    assert.deepEqual(
      dead.addrs.map(hex4),
      [],
      "a hostile scratch register reached memory — one of them is CONSUMED somewhere and " +
        "dropping it is not licensed; the rewrite must reproduce it",
    );

    const spilled = replayAddrs((mm) => {
      const r = oracle(mm);
      mm.regs.hl = u16(mm.regs.hl ^ 0x0101);
      return r;
    });
    assert.equal(spilled.frames, WHOLE_FRAMES, "the coordinate-clobber session ran short");
    assert.deepEqual(
      liveCells(spilled.addrs).map(hex4),
      [],
      "corrupting the moved coordinate reached a LIVE cell, so a caller consumes it after all " +
        "and the blindness this file records for the stale twin is wrong",
    );

    const control = replayAddrs((mm) => {
      const r = oracle(mm);
      mm.mem8[cellsOf(mm).fractionRow] ^= 1;
      return r;
    });
    assert.ok(
      liveCells(control.addrs).length > 0,
      "corrupting one of the four written bytes left no trace either, which is a claim about " +
        "the instrument before it is a claim about the registers: the experiment sees nothing",
    );
    console.log(
      `  DROPPED: ${dead.fired} hostile dispatches over ${dead.frames} frames move nothing; ` +
        `the moved coordinate spills into ${spilled.addrs.map(hex4).join(" ") || "nothing"} and ` +
        `no live cell; the control moves ${liveCells(control.addrs).map(hex4).join(" ")}`,
    );
  });

test("DEGENERATE: the real dispatch carries a zero displacement on BOTH axes", { skip }, () => {
  const before = entryState();
  assert.equal(before.mem16[WORLD_SCROLL_Y], 0, "the row displacement at the entry is no longer zero");
  assert.equal(before.mem16[WORLD_SCROLL_X], 0, "the column displacement at the entry is no longer zero");

  const after = before.clone();
  oracle(after);
  const moved = cellList(before).filter((at, i) => before.mem8[at] !== after.mem8[cellList(after)[i]]);
  assert.deepEqual(moved, [], "a byte moves at the real dispatch after all — re-derive the holes");

  const d = unitDiff(brokenNoOp, before);
  assert.notEqual(d, null, "even the live-out fails to catch a no-op here, so this entry gates nothing");
  assert.equal(d.where !== "ram", true, `the no-op was caught on RAM, which cannot move here — ${show(d)}`);
  console.log(`  DEGENERATE: no byte moves; only the live-out catches a no-op — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers and pc diverge and nothing else does", { skip }, () => {
  const m = craft({ wR: 138, fR: 203, wC: 129, fC: 88, dR: 0xff01, dC: 0x0180 });
  const a = m.clone();
  const b = m.clone();
  oracle(a);
  driftAtHalfWorldScroll(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(
    unexpected,
    [],
    "a register outside the excluded set diverged: only the flag byte, the pairs the oracle " +
      "assembles its arithmetic in, and the stack pointer may differ — the moved coordinate may not",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.hl, b.regs.hl, "the moved coordinate is live-out and must agree");
  const ca = cellsOf(a);
  const cb = cellsOf(b);
  for (const k of Object.keys(ca)) assert.equal(a.mem8[ca[k]], b.mem8[cb[k]], `live-out ${k}`);
  console.log(`  EXCLUDED: registers ${moved.join(", ")} and pc — the four bytes agree`);
});

test("WRITE-SET: across the crafted cross the oracle moves only the four bytes", { skip }, () => {
  const priors = craftedPriors();
  assert.ok(priors.length > 0, "vacuous: the crafted cross is empty");
  const touched = new Set();
  for (const p of priors) {
    const before = craft(p);
    const after = before.clone();
    const sp = before.regs.sp;
    oracle(after);
    for (const d of everyDiff(before, after)) if (!inScratch(d.addr, sp)) touched.add(d.addr);
  }
  assert.deepEqual(
    [...touched].sort((p, q) => p - q),
    cellList(entryState()).sort((p, q) => p - q),
    "the oracle's write-set outside the scratch window is not the four cells this file names",
  );
  console.log(`  WRITE-SET: ${[...touched].sort((p, q) => p - q).map(hex4).join(" ")} over ${priors.length} entries`);
});

test("REAL TRAFFIC: every distinct dispatch three sessions present, replayed", { skip }, () => {
  let checked = 0;
  for (const [label, opts] of TAPES) {
    const c = corpus(label, opts);
    assert.equal(c.stoppedBy, null, `the ${label} session stopped early: ${c.stoppedBy}`);
    assert.equal(c.frames, CORPUS_FRAMES, `the ${label} session lost a frame`);
    assert.ok(c.dispatches > 0, `vacuous: the ${label} session never reached the routine`);
    assert.ok(c.records.length > 0, `vacuous: the ${label} session recorded no input`);
    for (const rec of c.records) {
      // The tuple is the WHOLE input, or this fails: seating it must reproduce what the live
      // dispatch really produced, off a machine captured from a different frame entirely.
      const live = seated(rec);
      oracle(live);
      const cl = cellsOf(live);
      assert.deepEqual(
        [live.mem8[cl.wholeRow], live.mem8[cl.fractionRow], live.mem8[cl.wholeColumn], live.mem8[cl.fractionColumn]],
        rec.out,
        `${label}: the recorded tuple does not reproduce the live dispatch, so it is not the ` +
          "whole input and this corpus is measuring something else",
      );
      assert.equal(live.regs.hl, rec.hl, `${label}: the replayed moved coordinate is not the live one`);

      const d = unitDiff(driftAtHalfWorldScroll, seated(rec));
      assert.equal(d, null, `${label} ${hex4(rec.dR)}/${hex4(rec.dC)}: ${show(d)}`);
      checked++;
    }
    const ds = displacementsOf(c.records);
    console.log(
      `  REAL TRAFFIC/${label}: ${c.records.length} distinct inputs over ${c.dispatches} ` +
        `dispatches in ${c.frames} frames, ${ds.length} distinct displacements — all identical`,
    );
  }
  assert.ok(checked > 0, "vacuous: no record was replayed");
  const bases = [...new Set(everyRecord().map((rec) => `${hex4(rec.ix)}/${hex4(rec.iy)}`))];
  assert.deepEqual(
    bases,
    [`${hex4(entryState().regs.ix)}/${hex4(entryState().regs.iy)}`],
    "more than one object slot now reaches this routine, so the HOLE this file states — that " +
      "the record bases never vary — is out of date and the crafted arms should vary them",
  );
  console.log(`  REAL TRAFFIC: ${checked} records replayed, all off the one base pair ${bases[0]}`);
});

test("BLIND CORPUS: the shared tape presents nothing negative and nothing odd", { skip }, () => {
  const shared = displacementsOf(corpus("shared", {}).records);
  assert.ok(shared.length > 0, "vacuous: the shared tape never reached the routine");
  assert.deepEqual(
    shared.filter((d) => d >= NEGATIVE_FROM).map(hex4),
    [],
    "the shared tape now presents a negative displacement — the blindness this file is built " +
      "around has changed and the TEETH arms must be re-measured",
  );
  assert.deepEqual(
    shared.filter((d) => d % 2 === 1).map(hex4),
    [],
    "the shared tape now presents an odd displacement, so the rounding path is no longer dead " +
      "in it and the arms below have to be re-derived",
  );
  assert.ok(shared.some((d) => d !== 0), "the shared tape presents nothing but a zero displacement");

  const wide = displacementsOf(everyRecord());
  const negative = wide.filter((d) => d >= NEGATIVE_FROM);
  const negativeOdd = negative.filter((d) => d % 2 === 1);
  assert.ok(negative.length > 0, "no tape presents a negative displacement — the sign path is untested");
  assert.ok(negativeOdd.length > 0, "no tape presents a negative ODD displacement — rounding is untested");
  console.log(
    `  BLIND CORPUS: shared presents ${shared.map(hex4).join(" ")}; the three tapes together ` +
      `present ${wide.length}, ${negative.length} negative and ${negativeOdd.length} negative-odd`,
  );
});

test("CRAFTED: every displacement x position combination steps as the oracle steps it", { skip }, () => {
  const priors = craftedPriors();
  assert.equal(priors.length, DISPLACEMENTS.length ** 2 * POSITIONS.length, "the cross shrank");
  for (const p of priors) {
    const d = craftedDiff(driftAtHalfWorldScroll, p);
    assert.equal(d, null, `${JSON.stringify(p)}: ${show(d)}`);
  }
  console.log(`  CRAFTED: ${priors.length} entries identical`);
});

test("CARRY: a fraction swept over its whole range carries as the oracle carries", { skip }, () => {
  const priors = carryPriors();
  for (const p of priors) {
    const d = craftedDiff(driftAtHalfWorldScroll, p);
    assert.equal(d, null, `fraction=${p.fR}: ${show(d)}`);
  }
  const wrapped = craft({ wR: 255, fR: 255, wC: 0, fC: 0, dR: 1, dC: 0 });
  const c = cellsOf(wrapped);
  driftAtHalfWorldScroll(wrapped);
  assert.equal(wrapped.mem8[c.wholeRow], 0, "the whole byte must round, not widen");
  assert.equal(wrapped.mem8[c.fractionRow], 0, "the fraction must round too");
  console.log(`  CARRY: ${priors.length} fractions identical, including the top-of-range wrap`);
});

test("EXHAUSTIVE: all 65536 row displacements against a real position", { skip }, () => {
  const held = { wR: 138, fR: 203, wC: 129, fC: 88, dC: 0xff01 };
  const caught = sweepRowDisplacement(driftAtHalfWorldScroll, held);
  assert.deepEqual(caught.slice(0, 4).map(hex4), [], `the sweep diverged at ${caught.slice(0, 4).map(hex4)}`);
  assert.equal(caught.length, 0, `${caught.length} of ${WIDTH} displacements diverged`);
  console.log(`  EXHAUSTIVE: ${WIDTH} row displacements identical, column held at ${hex4(held.dC)}`);
});

test("EXHAUSTIVE: the shim charges exactly what the oracle charges, branchlessly", { skip }, () => {
  for (const dR of [0, 1, NEGATIVE_FROM - 1, NEGATIVE_FROM, WIDTH - 1]) {
    const m = craft({ wR: 1, fR: 2, wC: 3, fC: 4, dR, dC: WIDTH - 1 - dR });
    const before = m.cycles;
    oracle(m);
    assert.equal(m.cycles - before, ORACLE_TSTATES, `${hex4(dR)}: the shim's total is wrong`);
  }
  console.log(`  EXHAUSTIVE: the shim's ${ORACLE_TSTATES} T-states match the oracle`);
});

test("WHOLE-MACHINE: driven play moves nothing outside the scratch window", { skip }, () => {
  const w = replay(driftAtHalfWorldScroll);
  assert.ok(w.fired > 0, "vacuous: the override never dispatched in this many frames");
  assert.equal(w.frames, WHOLE_FRAMES, "the replay ran short of the frames asked for");
  assert.deepEqual(
    liveCells(w.addrs).map(hex4),
    [],
    "a live cell moved during a whole driven session with the rewrite wired",
  );
  assert.deepEqual(
    w.addrs.map(hex4),
    scratchWindow().map(hex4),
    "the drifting set is not the declared window — narrower means the window is over-specified, " +
      "wider means it is under-specified, and either way it must be re-measured",
  );
  console.log(`  WHOLE-MACHINE: ${w.frames} frames, ${w.fired} dispatches, only ${w.addrs.map(hex4).join(" ")} drift`);
});

test("BUDGET: the shared entry budget reaches this routine", { skip }, () => {
  const r = unitEquivalence(makeMachine, TARGET, oracle, oracle, { maxFrames: ENTRY_FRAMES });
  assert.equal(r.ram, null, "the budget reached the routine but the two oracle arms disagreed");
  console.log(`  BUDGET: ${ENTRY_FRAMES} shared frames reach the routine`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────────
// A gate that cannot fail is worthless. Each twin is a plausible way to get this routine wrong —
// a different written byte, the carry between them, the sign or the rounding of the halving, or
// the moved coordinate the caller is handed — and each must be caught by the same comparison the
// real arm passes.

/** The correct shortening, kept here only so a twin can differ from it in one named way. */
const half = (d) => d - ((d << 16) >> 17);

/** Move one split coordinate by an already-shortened displacement, the way the oracle does. */
function put(m, whole, fraction, displacement) {
  const moved = u16(((m.mem8[whole] << 8) + m.mem8[fraction]) + displacement);
  m.mem8[whole] = moved >> 8;
  m.mem8[fraction] = moved;
  m.regs.hl = moved;
}

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: adds the whole displacement, so the object keeps pace instead of falling behind. */
function brokenUnshortened(m) {
  const c = cellsOf(m);
  put(m, c.wholeRow, c.fractionRow, m.mem16[WORLD_SCROLL_Y]);
  put(m, c.wholeColumn, c.fractionColumn, m.mem16[WORLD_SCROLL_X]);
}

/** BUG: takes a quarter off instead of a half, so the object keeps three quarters of the pace. */
function brokenQuartered(m) {
  const c = cellsOf(m);
  const q = (d) => d - ((d << 16) >> 18);
  put(m, c.wholeRow, c.fractionRow, q(m.mem16[WORLD_SCROLL_Y]));
  put(m, c.wholeColumn, c.fractionColumn, q(m.mem16[WORLD_SCROLL_X]));
}

/** BUG: halves by shifting in zeros, so a displacement running the other way is lengthened. */
function brokenUnsigned(m) {
  const c = cellsOf(m);
  const h = (d) => d - (d >>> 1);
  put(m, c.wholeRow, c.fractionRow, h(m.mem16[WORLD_SCROLL_Y]));
  put(m, c.wholeColumn, c.fractionColumn, h(m.mem16[WORLD_SCROLL_X]));
}

/** BUG: rounds the half toward zero, which is what dividing and discarding the remainder does. */
function brokenTruncated(m) {
  const c = cellsOf(m);
  const h = (d) => d - ((signed(d) / 2) | 0);
  put(m, c.wholeRow, c.fractionRow, h(m.mem16[WORLD_SCROLL_Y]));
  put(m, c.wholeColumn, c.fractionColumn, h(m.mem16[WORLD_SCROLL_X]));
}

/** BUG: stores the whole bytes but never the fractions, so sub-steps never bank. */
function brokenWholeOnly(m) {
  const c = cellsOf(m);
  const step = (whole, fraction, d) => {
    m.regs.hl = u16(((m.mem8[whole] << 8) + m.mem8[fraction]) + half(d));
    m.mem8[whole] = m.regs.hl >> 8;
  };
  step(c.wholeRow, c.fractionRow, m.mem16[WORLD_SCROLL_Y]);
  step(c.wholeColumn, c.fractionColumn, m.mem16[WORLD_SCROLL_X]);
}

/** BUG: drifts the first coordinate and forgets the second one entirely. */
function brokenSecondSkipped(m) {
  const c = cellsOf(m);
  put(m, c.wholeRow, c.fractionRow, half(m.mem16[WORLD_SCROLL_Y]));
}

/** BUG: feeds each coordinate the other coordinate's displacement. */
function brokenSwapped(m) {
  const c = cellsOf(m);
  put(m, c.wholeRow, c.fractionRow, half(m.mem16[WORLD_SCROLL_X]));
  put(m, c.wholeColumn, c.fractionColumn, half(m.mem16[WORLD_SCROLL_Y]));
}

/** BUG: adds each half of the displacement to its own byte, so a fraction never carries. */
function brokenNoCarry(m) {
  const c = cellsOf(m);
  const step = (whole, fraction, d) => {
    const s = half(d);
    m.mem8[whole] = m.mem8[whole] + (s >> 8);
    m.mem8[fraction] = m.mem8[fraction] + (s & 0xff);
    m.regs.hl = u16((m.mem8[whole] << 8) + m.mem8[fraction]);
  };
  step(c.wholeRow, c.fractionRow, m.mem16[WORLD_SCROLL_Y]);
  step(c.wholeColumn, c.fractionColumn, m.mem16[WORLD_SCROLL_X]);
}

/** BUG: writes all four bytes correctly and hands the caller back a stale coordinate. */
function brokenStaleLiveOut(m) {
  const hl = m.regs.hl;
  driftAtHalfWorldScroll(m);
  m.regs.hl = hl;
}

// label -> [twin, a prior guaranteed to discriminate it, caught at the real dispatch?,
//           moves a LIVE cell over a whole driven session?]
const TWINS = [
  ["no-op", brokenNoOp, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 2, dC: 2 }, true, true],
  ["unshortened", brokenUnshortened, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 2, dC: 2 }, false, true],
  ["quartered", brokenQuartered, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 4, dC: 4 }, false, true],
  ["unsigned", brokenUnsigned, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 0xfe80, dC: 0xfe80 }, false, true],
  ["truncated", brokenTruncated, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 0xff01, dC: 0xff01 }, false, true],
  ["whole-only", brokenWholeOnly, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 2, dC: 2 }, false, true],
  ["second-skipped", brokenSecondSkipped, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 0, dC: 0x0180 }, true, true],
  ["swapped", brokenSwapped, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 0x0180, dC: 0xfe80 }, false, true],
  ["no-carry", brokenNoCarry, { wR: 0, fR: 255, wC: 0, fC: 0, dR: 2, dC: 0 }, false, true],
  ["stale-live-out", brokenStaleLiveOut, { wR: 0, fR: 0, wC: 0, fC: 0, dR: 2, dC: 2 }, true, false],
];

for (const [label, twin, discriminator, caughtAtDispatch, movesLiveCell] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT by a crafted entry`, { skip }, () => {
    const d = craftedDiff(twin, discriminator);
    assert.notEqual(d, null, `the gate PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught — ${show(d)}`);
  });

  test(`TEETH: the ${label} twin is CAUGHT across the crafted cross and the sweep`, { skip }, () => {
    const priors = craftedPriors();
    const caught = priors.filter((p) => craftedDiff(twin, p) !== null).length;
    assert.ok(caught > 0, `the cross missed the ${label} twin on every one of its entries`);
    const swept = sweepRowDisplacement(twin, { wR: 138, fR: 203, wC: 129, fC: 88, dC: 0xff01 });
    assert.ok(swept.length > 0, `the 65536-displacement sweep missed the ${label} twin entirely`);
    console.log(
      `  TEETH/${label}: caught on ${caught} of ${priors.length} crafted entries and ` +
        `${swept.length} of ${WIDTH} swept displacements`,
    );
  });

  test(`TEETH: the ${label} twin at the real dispatch, hole pinned`, { skip }, () => {
    const d = unitDiff(twin, entryState());
    assert.equal(
      d !== null,
      caughtAtDispatch,
      `the real dispatch's blindness to the ${label} twin changed — re-derive the holes`,
    );
    console.log(`  TEETH/${label}: real dispatch ${d ? `caught — ${show(d)}` : "BLIND, as recorded"}`);
  });

  test(`TEETH: the ${label} twin against a whole driven session`, { skip }, () => {
    const w = replay(twin);
    assert.ok(w.fired > 0, `vacuous: the ${label} twin never dispatched`);
    assert.equal(w.frames, WHOLE_FRAMES, "the replay ran short of the frames asked for");
    assert.equal(
      liveCells(w.addrs).length > 0,
      movesLiveCell,
      movesLiveCell
        ? `the ${label} twin ran a whole session without moving one live cell — the replay has ` +
            "no teeth for it"
        : `the ${label} twin now moves a live cell, so the reason this file gives for the ` +
            "replay being blind to it is wrong and must be re-derived",
    );
    console.log(
      `  TEETH/${label}: ${
        movesLiveCell
          ? `${liveCells(w.addrs).length} live cells move`
          : `BLIND to the replay — only ${w.addrs.map(hex4).join(" ") || "nothing"} drifts, all stack`
      }`,
    );
  });
}

test("BLIND CORPUS: the shared tape cannot catch the sign or the rounding twin", { skip }, () => {
  for (const [label, twin] of [["unsigned", brokenUnsigned], ["truncated", brokenTruncated]]) {
    const blind = replay(twin, "shared", {});
    assert.ok(blind.fired > 0, `vacuous: the ${label} twin never dispatched on the shared tape`);
    assert.equal(blind.frames, WHOLE_FRAMES, "the shared replay ran short");
    assert.deepEqual(
      liveCells(blind.addrs).map(hex4),
      [],
      `the shared tape now catches the ${label} twin — good, but the turning tape was built ` +
        "because it did not, and this arm has to be re-derived rather than deleted",
    );
    const turning = replay(twin);
    assert.ok(liveCells(turning.addrs).length > 0, "the turning tape must catch what the shared tape cannot");
    console.log(
      `  BLIND CORPUS/${label}: ${WHOLE_FRAMES} shared frames move no live cell with the twin ` +
        `wired; the turning tape moves ${liveCells(turning.addrs).length}`,
    );
  }
});
