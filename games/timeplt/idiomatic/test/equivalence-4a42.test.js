// SPDX-License-Identifier: GPL-3.0-only
/**
 * paintRoundWonBandTailThenStepSequence — memory-equivalent to the frozen oracle at ROM 0x4A42. GATE: crafted seats over a
 * coherent captured machine, work-RAM compared with the dead stack scratch below the seat masked
 * out (the oracle nests calls and tail-rets the caller's slot, the rewrite calls its dissolved
 * callees directly), the +2 SP re-seat and the return value checked, registers excluded (the
 * dissolved callees drop the register dance and no caller consumes one, since the block is only
 * ever reached inline), plus a reachability arm and teeth. Run:
 *   node --test games/timeplt/idiomatic/test/equivalence-4a42.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { paintRoundWonBandTailThenStepSequence as candidate } from "../paintRoundWonBandTailThenStepSequence.js";
import { loc_4a42 as oracle } from "../../translated/loc_4a42.js";
import { u8, u16 } from "../../../../core/int.js";
import { fillCellRun } from "../fillCellRun.js";
import { setSavedPenFromEra } from "../setSavedPenFromEra.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";

const TARGET = 0x4a42;
const RANGE = 0x4a0f; // the transcribed range that swallows this block and runs it inline
const POS = 0x07e6; // a live routine the tape dispatches -- the reachability control
const CAPTURE_FRAMES = 3000;

const BASE_COLOUR = 0xad0c;
const ACTIVE_PLAYER = 0xad32;
const PLAYER_ONE_FIELD = 0xad1b;
const PLAYER_TWO_FIELD = 0xad2b;
const SEQUENCE_SUBSTEP = 0xa9ac;

const ROW = 0x20;
const ROW_A = 0xa3b1;
const ROW_B = 0xa1d1;
const CELL_HI = 0xa210;
const CELL_MID = 0xa211;
const CELL_LO = 0xa212;

// Every data write lands at or below here; the seated stack is far above it, so masking the
// scratch window can never hide a data divergence. Asserted against the measured floor below.
const DATA_TOP = 0xadff;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

// ── the masked comparison ─────────────────────────────────────────────────────────────────

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
  const retOracle = oracle(a);
  const retCand = cand(b);
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seat) continue;
    escaped = { addr, oracle: da[i], candidate: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Cells the oracle moves from a state, ignoring the masked stack scratch. */
function footprint(machine) {
  const a = machine.clone();
  const seat = a.regs.sp;
  let low = seat;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  const before = a.dumpState().slice();
  oracle(a);
  const now = a.dumpState();
  const cells = [];
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && !(addr >= low && addr < seat) && addr <= DATA_TOP) cells.push(addr);
  }
  return cells;
}

// ── the captured entry and the crafted seats ──────────────────────────────────────────────

let entry = null;
function entryState() {
  if (entry === null) {
    const real = TRANSLATED.get(POS);
    const m = makeMachine(new Map([[POS, (mm) => {
      if (entry === null) entry = mm.clone();
      return real(mm);
    }]]));
    m.runFrames(ENTRY_FRAMES);
  }
  return entry;
}

function seat(spec) {
  const m = entryState().clone();
  m.regs.hl = spec.hl;
  m.regs.a = spec.a;
  m.regs.c = spec.c;
  m.mem8[BASE_COLOUR] = spec.base;
  m.mem8[ACTIVE_PLAYER] = spec.active;
  m.mem8[0xad14] = spec.r1;
  m.mem8[0xad24] = spec.r2;
  if (spec.prehead) m.mem8[u16(spec.hl + 1)] = spec.a; // makes the first-cell twin invisible here
  return m;
}

/** The cursor's landing zone, the base colour and the active player are all varied. */
function scenarios() {
  return [
    ["inline", seat({ hl: 0xa40d, a: 0x00, c: 0x14, base: 0x08, active: 0, r1: 3, r2: 0 })],
    ["altV", seat({ hl: 0xa500, a: 0x33, c: 0x55, base: 0x01, active: 0, r1: 5, r2: 0 })],
    ["altC", seat({ hl: 0xa100, a: 0x07, c: 0x99, base: 0x00, active: 0xff, r1: 0, r2: 7 })],
    ["baseff", seat({ hl: 0xa680, a: 0xaa, c: 0xbb, base: 0xff, active: 0xff, r1: 1, r2: 2 })],
    ["prehead", seat({ hl: 0xa300, a: 0x42, c: 0x24, base: 0x08, active: 0, r1: 3, r2: 0, prehead: true })],
  ];
}

// ── broken twins ──────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every parameter matches paintRoundWonBandTailThenStepSequence by default. */
function twin({ tail = 0x0e, skipFirst = false, rowA = ROW_A, cellHiA = 0xa0, pen = true, step = true }) {
  return (m) => {
    const { regs, mem8 } = m;
    const head = regs.a;
    const body = regs.c;
    let cur = u16(regs.hl + 1);
    if (!skipFirst) mem8[cur] = head;
    for (let i = 0; i < 13; i++) mem8[cur = u16(cur + 1)] = body;
    for (let i = 0; i < 4; i++) mem8[cur = u16(cur + 1)] = tail;
    const base = mem8[BASE_COLOUR];
    regs.hl = rowA;
    regs.a = u8(0xa0 + base);
    fillCellRun(m);
    regs.hl = ROW_B;
    regs.a = u8(0x20 + base);
    fillCellRun(m);
    mem8[CELL_HI] = u8(cellHiA + base);
    mem8[u16(CELL_HI - ROW)] = u8(0x20 + base);
    mem8[CELL_LO] = u8(0xe0 + base);
    mem8[u16(CELL_LO - ROW)] = u8(0x60 + base);
    mem8[CELL_MID] = u8(0xa0 + base);
    mem8[u16(CELL_MID - ROW)] = u8(0x20 + base);
    if (pen) setSavedPenFromEra(m);
    if (step) advanceSequenceSubStep(m);
  };
}

const TWINS = [
  ["no-op", () => {}, 5],
  ["wrong-tail", twin({ tail: 0x0f }), 5],
  ["skip-first-cell", twin({ skipFirst: true }), 4],
  ["wrong-rowA", twin({ rowA: 0xa3b0 }), 5],
  ["wrong-cellHi-offset", twin({ cellHiA: 0xa1 }), 5],
  ["skip-pen", twin({ pen: false }), 5],
  ["skip-step", twin({ step: false }), 5],
];

// ── the gate ──────────────────────────────────────────────────────────────────────────────

test("EQUAL: work-RAM identical outside the masked stack scratch on every seat", { skip }, () => {
  assert.notEqual(entryState(), null, "vacuous: the tape never reached the capture routine");
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.escaped, null, r.escaped && `${label} escaped the mask at ${hex4(r.escaped.addr)}`);
    // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
    assert.ok(r.low > DATA_TOP, `${label}: the stack window ${hex4(r.low)} reached into game data`);
  }
  console.log("  EQUAL: 5 seats identical outside the masked stack window");
});

test("SEATS DIFFER: the cursor and the player branch move genuinely different cells", { skip }, () => {
  const prints = Object.fromEntries(scenarios().map(([l, m]) => [l, footprint(m)]));
  // ★ Vacuity guard: a different cursor must paint different cells, or the seats changed nothing.
  assert.notEqual(prints.inline.join(","), prints.altC.join(","), "two cursors paint the same cells");
  // ★ The dissolved pen really branches on the active player; the dissolved step always fires.
  assert.ok(prints.inline.includes(PLAYER_ONE_FIELD) && !prints.inline.includes(PLAYER_TWO_FIELD),
    "player one's seat did not write player one's save field");
  assert.ok(prints.altC.includes(PLAYER_TWO_FIELD) && !prints.altC.includes(PLAYER_ONE_FIELD),
    "player two's seat did not write player two's save field");
  for (const [label, cells] of Object.entries(prints)) {
    assert.ok(cells.includes(SEQUENCE_SUBSTEP), `${label} did not step the sequence sub-step`);
  }
  console.log(`  SEATS DIFFER: inline moves ${prints.inline.length} cells, altC ${prints.altC.length}`);
});

test("SP and RETURN: the oracle re-seats two bytes higher and both return the same", { skip }, () => {
  for (const [label, m] of scenarios()) {
    const r = compare(candidate, m);
    assert.equal(r.spDiff, 2, `${label}: the oracle tail-rets the caller's slot and the rewrite does not`);
    assert.equal(r.retOracle, r.retCand, `${label}: the return value diverged`);
  }
  console.log("  SP: +2 on every seat; return values identical (undefined)");
});

test("UNREACHED: neither tape dispatches this block, with a live control", { skip }, () => {
  for (const [label, opts] of [["coin-start", {}], ["attract", { tape: [] }]]) {
    const seen = { [TARGET]: 0, [RANGE]: 0, [POS]: 0 };
    const ov = new Map();
    for (const a of [TARGET, RANGE, POS]) {
      const real = TRANSLATED.get(a);
      ov.set(a, (mm) => { seen[a]++; return real(mm); });
    }
    const m = makeMachine(ov, opts);
    m.runFrames(CAPTURE_FRAMES);
    assert.equal(m.stoppedBy, null, `the ${label} run stopped early: ${m.stoppedBy}`);
    // ★ The zeroes are evidence only because the same taps, in the same run, counted a live site.
    if (label === "coin-start") assert.ok(seen[POS] > 0, "the control tap fired nothing; the zeroes mean nothing");
    assert.equal(seen[TARGET], 0, `${label} now dispatches this block; capture plain entries instead`);
    assert.equal(seen[RANGE], 0, `${label} now dispatches the swallowing range as a call, not inline`);
    console.log(`  UNREACHED: ${label} — block ${seen[TARGET]}, range ${seen[RANGE]}, control ${seen[POS]}`);
  }
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of seats`, { skip }, () => {
    let caught = 0;
    for (const [, m] of scenarios()) if (compare(brokenTwin, m).escaped) caught++;
    assert.ok(expected > 0, `the ${label} twin is not caught at all`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${scenarios().length} seats`);
  });
}
