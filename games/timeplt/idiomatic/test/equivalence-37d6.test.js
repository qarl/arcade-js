// SPDX-License-Identifier: GPL-3.0-only
/**
 * spawnEnemyIntoFreeSlotElseStepSearch — memory-equivalent to the frozen oracle at ROM 0x37D6, held to the frogger
 * standard: RAM (masked for the dead stack scratch the dissolved tails leave) is the whole of the
 * contract, and only the routine's genuine register live-outs are pinned beside it. There are none —
 * the table walk holds its cursor and index in JS locals, every arm hands on to a callee that reseats
 * what it needs, and the four callers each tail-return this result and read no register back — so
 * GENUINE_LIVE_OUTS is empty and memory is the whole contract. A pure leaf: every ROM call is
 * dissolved into a direct import, so the rewrite pushes no return addresses and omits its own ret;
 * the whole recursive pass is replayed on each side (the loop re-enters this address), the +2 SP
 * re-seat and the return checked, and a scratch-not-pinned control sits beside the RAM measurement.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-37d6.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { spawnEnemyIntoFreeSlotElseStepSearch as candidate } from "../spawnEnemyIntoFreeSlotElseStepSearch.js";
import { loc_37d6 as oracle } from "../../translated/loc_37d6.js";
import { drawRandomByte } from "../drawRandomByte.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { pickScriptAtRandomOrInTurn } from "../pickScriptAtRandomOrInTurn.js";
import { stepCraftFlightScript } from "../stepCraftFlightScript.js";
import { u8, u16 } from "../../../../core/int.js";

const TARGET = 0x37d6;
const SCROLL_ANGLE = 0xa802;
const HEADING_TABLE = 0x39fb;
const VELOCITY_TABLE = 0x3a3b;
const SHARED_ZERO = 0xacc5;
const BANK_TOP = 0xa8b0;
const RECORD_STRIDE = 0x10;
const BANK_SLOTS = 5;

// Every game write lands at or below here; the stack seats far above it, so masking the scratch
// window can never hide a data divergence. Asserted against the measured floor below.
const DATA_TOP = 0xadff;
const COIN_TURNS = 40;
const ATTRACT_TURNS = 24;

// The frogger standard: RAM is the contract and only genuine register live-outs are pinned beside it.
// The four callers each tail-return and read no register back, and the table walk keeps its cursor
// and index in JS locals, so there are none — memory is the whole of it.
const GENUINE_LIVE_OUTS = [];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── whole-pass wiring ───────────────────────────────────────────────────────────────────────

// ★ The loop re-enters this address every turn, so a comparison that ran the rewrite only at the
// top would run the frozen twin for turns two onward. dispatchBody makes the loop's own re-entries
// run whichever side is under way, so the whole pass is on one implementation.
let dispatchBody = oracle;
function runAs(body, m) {
  dispatchBody = body;
  try {
    return body(m);
  } finally {
    dispatchBody = oracle;
  }
}

function captureTape(opts) {
  let collecting = true;
  const entries = [];
  const m = makeMachine(new Map([[TARGET, (mm) => {
    if (collecting) entries.push(mm.clone());
    return dispatchBody(mm);
  }]]), opts);
  const frames = m.runFrames(ENTRY_FRAMES);
  collecting = false;
  assert.equal(m.stoppedBy, null, `the capture run stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, ENTRY_FRAMES, "the capture run ran short");
  return entries;
}

let corpusCache = null;
function corpus() {
  if (!corpusCache) corpusCache = [...captureTape({}), ...captureTape({ tape: [] })];
  return corpusCache;
}

/**
 * Oracle vs candidate on independent clones. The oracle pushes a return address per delegated call
 * and rets its own, all popped again; the rewrite models no stack. So the diff excludes [low, seat)
 * — low measured by watching the oracle's own pushes — and anything outside it has escaped. Registers
 * are NOT pinned by a ceiling — only GENUINE_LIVE_OUTS (empty) is, so a scratch register left
 * anywhere is deliberately ignored.
 */
function compare(cand, machine) {
  const a = machine.clone();
  const b = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  const retOracle = runAs(oracle, a);
  const retCand = runAs(cand, b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  let liveOut = null;
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) { liveOut = { k, a: a.regs[k], b: b.regs[k] }; break; }
  }
  return { escaped, liveOut, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Cells the oracle moves from a state, ignoring the stack scratch — a turn's footprint. */
function footprint(machine) {
  const before = machine.dumpState().slice();
  const a = machine.clone();
  runAs(oracle, a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

function firstFree() {
  const e = corpus().find((m) => m.mem8[m.regs.ix & 0xffff] === 0);
  assert.notEqual(e ?? null, null, "vacuous: no captured turn found a free slot");
  return e;
}

/** A turn seated on a bank whose every reachable head is busy, so no slot is filled. */
function craftAllBusy() {
  const m = firstFree().clone();
  m.regs.ix = BANK_TOP;
  m.regs.b = BANK_SLOTS;
  for (let i = 0; i < BANK_SLOTS; i++) m.mem8[BANK_TOP - i * RECORD_STRIDE] = 0xff;
  return m;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────────

/**
 * The rewrite with one deliberate defect each; every parameter matches spawnEnemyIntoFreeSlotElseStepSearch by default. On the
 * occupied-slot path it walks the pass with ITSELF rather than delegating: the real close tail now
 * imports the concrete generator, so calling it would run the correct body on every turn but the
 * first and hide the defect on all of them. Stepping and re-entering `body` keeps the whole pass on
 * the twin, which is what the loop does for the oracle through its own dispatch.
 */
function twin({ noop = false, claim = 0xff, facingBias = 0x80, jitterBias = 0x08, animate = true }) {
  return function body(m, record = m.regs.ix, entry = m.regs.iy) {
    if (noop) return;
    const { regs, mem8 } = m;
    if (mem8[record + 0x00] !== 0) {
      regs.ix = regs.ix - RECORD_STRIDE;
      regs.iy = regs.iy - 2;
      regs.b = regs.b - 1;
      return regs.b !== 0 ? body(m) : undefined;
    }
    mem8[record + 0x00] = claim;
    const base = mem8[SCROLL_ANGLE] >> 2;
    const jitter = (drawRandomByte(m) & 0x0f) - jitterBias;
    regs.a = (base + jitter) & 0x3f;
    regs.hl = HEADING_TABLE;
    regs.a = u8(fetchTableByte(m) * 4);
    regs.hl = VELOCITY_TABLE;
    mem8[entry + 0x31] = fetchTableByte(m);
    regs.hl = u16(regs.hl + 1);
    regs.a = mem8[regs.hl];
    mem8[entry + 0x00] = regs.a;
    regs.a = u8(mem8[SCROLL_ANGLE] + facingBias);
    mem8[record + 0x01] = regs.a;
    mem8[record + 0x02] = regs.a;
    mem8[record + 0x0a] = pickScriptAtRandomOrInTurn(m);
    regs.a = 0;
    mem8[SHARED_ZERO] = regs.a;
    mem8[record + 0x03] = 0x00;
    mem8[record + 0x05] = 0x00;
    mem8[record + 0x09] = 0x20;
    if (animate) stepCraftFlightScript(m, record);
    mem8[record + 0x0e] = 0x00;
  };
}

// ── scratch-not-pinned controls: a register-only twin passes by design; RAM still bites ──────────
// With no genuine register live-outs, a twin that only scribbles a scratch register after the routine
// is DELIBERATELY not flagged; the same measurement must still catch a scribbled RAM cell.
const scribbleScratchReg = (m) => { const r = candidate(m); m.regs.iy = (m.regs.iy + 1) & 0xffff; return r; };
const SCRIBBLE_CELL = 0xacc2; // a compared data cell the routine never touches
const scribbleData = (m) => { const r = candidate(m); m.mem8[SCRIBBLE_CELL] ^= 0xff; return r; };

const TWINS = [
  ["no-op", twin({ noop: true }), 44],
  ["wrong-claim", twin({ claim: 0xfe }), 44],
  ["wrong-facing", twin({ facingBias: 0x81 }), 44],
  ["skip-animation", twin({ animate: false }), 44],
  ["wrong-jitter", twin({ jitterBias: 0x07 }), 44],
];

function sweepCorpus(cand) {
  let caught = 0;
  for (const e of corpus()) { const r = compare(cand, e); if (r.escaped || r.liveOut) caught++; }
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: RAM identical outside the masked stack scratch", { skip }, () => {
  const r = compare(candidate, firstFree());
  assert.equal(r.escaped, null, r.escaped && `escaped the mask at ${hex4(r.escaped.addr)}`);
  assert.equal(r.liveOut, null, r.liveOut && `a pinned live-out diverged: ${r.liveOut.k}`);
  // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
  assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
  console.log(`  EQUAL: window [${hex4(r.low)},${hex4(r.seat)}) masked, spDiff ${r.spDiff}`);
});

test("CORPUS: every turn of both tapes replays identically, and the corpus is not all no-ops",
  { skip }, () => {
    for (const e of corpus()) {
      const r = compare(candidate, e);
      assert.equal(r.escaped, null, `${hex4(e.regs.ix)}: escaped at ${r.escaped && hex4(r.escaped.addr)}`);
      assert.equal(r.liveOut, null, `${hex4(e.regs.ix)}: live-out ${r.liveOut && r.liveOut.k} diverged`);
    }
    const writing = corpus().filter((e) => footprint(e) > 0).length;
    assert.ok(writing > 0, "no captured turn makes the oracle write a byte, so the corpus is all " +
      "no-ops and every arm over it would pass a rewrite that did nothing");
    assert.equal(captureTape({}).length, COIN_TURNS, "the coin-start turn count moved");
    assert.equal(captureTape({ tape: [] }).length, ATTRACT_TURNS, "the attract turn count moved");
    console.log(`  CORPUS: ${corpus().length} turns identical, ${writing} of them make the oracle write`);
  });

test("PATHS: a claimed slot and an all-busy bank move different amounts", { skip }, () => {
  const free = footprint(firstFree());
  const allBusy = footprint(craftAllBusy());
  // ★ Vacuity guard: the claim path writes and the exhausted-bank path does not, or a rewrite that
  // ignored the branch would pass.
  assert.ok(free > 0, "the free-slot path wrote nothing");
  assert.equal(allBusy, 0, "the all-busy bank wrote something, so the branch is not what it seems");
  const r = compare(candidate, craftAllBusy());
  assert.equal(r.escaped, null, "the all-busy pass diverged");
  assert.equal(r.liveOut, null, "the all-busy pass diverged on a pinned live-out");
  console.log(`  PATHS: free moves ${free} cells, all-busy ${allBusy}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const e of [firstFree(), craftAllBusy()]) {
    const r = compare(candidate, e);
    assert.equal(r.spDiff, 2, "the oracle pops a return the rewrite does not");
    assert.equal(r.retOracle, r.retCand, "the return value diverged");
  }
  console.log("  SP: +2 on every path; return values identical");
});

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // No genuine register live-outs, so a twin that only scribbles a scratch register after the routine
  // is DELIBERATELY not flagged — yet the same measurement must still catch a scribbled RAM cell, or
  // the clean read on the register twin would be worthless.
  const states = [firstFree(), ...corpus().slice(0, 24)];
  for (const s of states) {
    const rReg = compare(scribbleScratchReg, s);
    assert.ok(!(rReg.escaped || rReg.liveOut),
      "a scratch-register scribble was flagged, but this routine has no genuine register live-outs to pin");
    const rData = compare(scribbleData, s);
    assert.ok(rData.escaped || rData.liveOut, "the RAM measurement missed a scribbled cell, so it has no teeth");
    assert.notEqual(rData.escaped, null, "the RAM scribble must be caught on a cell, not a register");
  }
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${states.length}`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of turns`, { skip }, () => {
    const caught = sweepCorpus(brokenTwin);
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${corpus().length} turns`);
  });
}
