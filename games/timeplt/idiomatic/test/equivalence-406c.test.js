// SPDX-License-Identifier: GPL-3.0-only
/**
 * runOneShotAnimatedObjectSlot — memory-equivalent to the frozen oracle at ROM 0x406C. Dissolving the three lifted
 * callees drops their ROM rets, so the oracle rets for itself (SP +2) and leaves dead return
 * addresses below the seated SP; RAM is compared with that window masked (its floor measured by
 * watching the oracle's own pushes), the SP drift asserted, and registers held to a measured
 * ceiling rather than compared — the live-out is memory. Reached only by a driven fire tape.
 * Run: node --test games/timeplt/idiomatic/test/equivalence-406c.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { ROUTINES as TRANSLATED } from "../../routines.js";
import { runOneShotAnimatedObjectSlot as candidate } from "../runOneShotAnimatedObjectSlot.js";
import { loc_406c as oracle } from "../../translated/loc_406c.js";
import { clampOneShotCountdownThenRequestSound } from "../clampOneShotCountdownThenRequestSound.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { fetchTableByte } from "../fetchTableByte.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x406c;
// The slot sweep this call sits in: reached by the shared tape while the target is not.
const SWEEP_TAIL = 0x400b;

const COUNTER = 0;
const REARM_AT = 0x3c;
const SHAPE_FLOOR = 0x1c;
const SHAPE_TABLE = 0x4094;
const SPRITE_SHAPE = 1;
const SPRITE_ATTR = 0x30;
const SPRITE_TAIL = 0x31;
const SHAPE_ATTR = 0x0e;

// Registers the dissolved callees do not reproduce; not a live-out, held as a ceiling not a demand.
const MOVED = ["a", "d", "e", "f", "h", "l", "sp"];
const DATA_TOP = 0xadff;
const SP_DRIFT = 2;

const TAPE_FRAMES = 2000;
const DISPATCHES = 59;
const FIRST_DISPATCH = 1899;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) =>
  d ? `${d.addr == null ? "reg" : hex4(d.addr)}: oracle=${d.a} candidate=${d.b}` : "identical";

/** Coin, start, then the trigger held while the stick walks the compass — the tape that fires. */
function drivenTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: TAPE_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let step = 0; step < 40; step++) {
    tape.push({ frame, port: IN1, bits: compass[step % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}
const drivenMachine = (overrides) => makeMachine(overrides, { tape: drivenTape() });

// ── the captured corpus ─────────────────────────────────────────────────────────────────

let corpus = null;
let firstFrame = null;
let dispatchCount = 0;

function capture() {
  if (corpus) return corpus;
  const entries = [];
  const m = drivenMachine(new Map([[TARGET, (mm) => {
    dispatchCount++;
    if (entries.length === 0) firstFrame = mm.frames.length;
    entries.push(mm.clone());
    return oracle(mm);
  }]]));
  m.runFrames(TAPE_FRAMES);
  assert.equal(m.stoppedBy, null, `the driven run stopped early: ${m.stoppedBy}`);
  corpus = entries;
  return corpus;
}

// ── the masked comparison ─────────────────────────────────────────────────────────────────

/**
 * Oracle vs candidate on clones. The oracle rets and nests calls, leaving dead return addresses in
 * [low, seat) below the seated SP; low is measured from its own pushes, and any diff outside the
 * window has escaped.
 */
function compare(cand, machine) {
  const seat = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
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
    if (addr !== null && addr >= low && addr < seat) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  return { escaped, low, seat, spDiff: a.regs.sp - b.regs.sp, retOracle, retCand };
}

/** Bytes the oracle moves from a state, ignoring the stack scratch — a dispatch's footprint. */
function footprint(machine) {
  const a = machine.clone();
  const before = a.dumpState().slice();
  const seat = a.regs.sp;
  oracle(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    const addr = a.stateOffsetToAddr(i);
    if (now[i] !== before[i] && addr !== null && addr <= DATA_TOP && addr < seat) n++;
  }
  return n;
}

/** Registers a candidate parts company on outside the declared ceiling, over the corpus. */
function strayRegs(cand) {
  const stray = new Set();
  for (const e of capture()) {
    const a = e.clone();
    const b = e.clone();
    oracle(a);
    cand(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k] && !MOVED.includes(k)) stray.add(k);
  }
  return [...stray];
}

// ── the twins ─────────────────────────────────────────────────────────────────────────────

/** The rewrite with one deliberate defect each; every knob matches runOneShotAnimatedObjectSlot by default. */
function twin({ rearm = true, drift = true, floor = SHAPE_FLOOR, table = SHAPE_TABLE,
  shape = true, attr = true, clear = true, shift = 2 } = {}) {
  return (m) => {
    const { regs, mem8 } = m;
    const object = regs.ix;
    const sprite = regs.iy;
    if (rearm && mem8[object + COUNTER] >= REARM_AT) clampOneShotCountdownThenRequestSound(m);
    mem8[object + COUNTER] = (mem8[object + COUNTER] - 1) & 0xff;
    if (mem8[object + COUNTER] === 0) {
      if (clear) {
        mem8[sprite] = 0;
        mem8[sprite + SPRITE_TAIL] = 0;
      }
      return;
    }
    if (drift) driftWithWorldScroll(m);
    const counter = mem8[object + COUNTER];
    if (counter < floor) return;
    const off = (counter - floor) & 0xff;
    regs.a = ((off >> shift) | (off << (8 - shift))) & 0x0f;
    regs.hl = table;
    fetchTableByte(m);
    if (shape) mem8[sprite + SPRITE_SHAPE] = regs.a;
    if (attr) mem8[sprite + SPRITE_ATTR] = SHAPE_ATTR;
  };
}

/** Control for the register ceiling: scribbles B, which runOneShotAnimatedObjectSlot never touches. */
function brokenMovesSpareRegister(m) {
  candidate(m);
  m.regs.b = (m.regs.b + 1) & 0xff;
}

const TWINS = [
  ["no-op", () => {}, 59],
  ["skip-rearm", twin({ rearm: false }), 1],
  ["skip-drift", twin({ drift: false }), 58],
  ["floor-off-by-one", twin({ floor: 0x1b }), 5],
  ["skip-shape", twin({ shape: false }), 6],
  ["no-expiry-clear", twin({ clear: false }), 1],
  ["index-shift", twin({ shift: 1 }), 27],
  ["wrong-table", twin({ table: SHAPE_TABLE + 1 }), 23],
];

// ── the gate ─────────────────────────────────────────────────────────────────────────────

test("REACHED: only by the driven fire tape, with a live positive control", { skip }, () => {
  const entries = capture();
  assert.ok(entries.length > 0, "vacuous: even the driven tape never reached the routine");
  assert.equal(dispatchCount, DISPATCHES, "the driven dispatch count moved");
  assert.equal(firstFrame, FIRST_DISPATCH, "the frame it is first reached on moved");
  const seen = { [TARGET]: 0, [SWEEP_TAIL]: 0 };
  const realTail = TRANSLATED.get(SWEEP_TAIL);
  const m = makeMachine(new Map([
    [TARGET, (mm) => (seen[TARGET]++, oracle(mm))],
    [SWEEP_TAIL, (mm) => (seen[SWEEP_TAIL]++, realTail(mm))],
  ]));
  m.runFrames(ENTRY_FRAMES);
  assert.equal(m.stoppedBy, null, `the shared run stopped early: ${m.stoppedBy}`);
  // The zero is evidence only because the same taps saw the sweep this call sits in run hundreds
  // of times; a tap that could never fire looks exactly like an address nothing reaches.
  assert.ok(seen[SWEEP_TAIL] > 0, "the shared run counted nothing at the slot sweep either, so the " +
    "instrument is broken and the zero beside it means nothing");
  assert.equal(seen[TARGET], 0, "the shared tape now reaches this address, so this gate should " +
    "capture from it instead of the driven tape");
  console.log(`  REACHED: ${dispatchCount} driven dispatches from frame ${firstFrame}; shared tape ` +
    `${seen[TARGET]} here, ${seen[SWEEP_TAIL]} at the sweep`);
});

test("EQUAL at every real dispatch: RAM identical outside the masked stack scratch", { skip }, () => {
  let widest = 0;
  for (const e of capture()) {
    const r = compare(candidate, e);
    assert.equal(r.escaped, null, r.escaped && `a divergence escaped the mask at ${show(r.escaped)}`);
    assert.equal(r.spDiff, SP_DRIFT, "the oracle pops its return address and the rewrite does not");
    assert.equal(r.retOracle, r.retCand, "the return value diverged");
    // ★ The mask is safe only if it never covers a data cell: prove its floor sits above them all.
    assert.ok(r.low > DATA_TOP, `the stack window ${hex4(r.low)} reached down into game data`);
    widest = Math.max(widest, r.seat - r.low);
  }
  console.log(`  EQUAL: ${capture().length} dispatches identical; widest scratch window ${widest} ` +
    "bytes, spDiff " + SP_DRIFT);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const r = compare(() => {}, capture()[0]);
  assert.notEqual(r.escaped, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(r.escaped.addr, null, "the no-op must be caught on a cell, not a register");
  assert.ok(footprint(capture()[0]) > 0, "the oracle writes nothing here, so equality is trivial");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(r.escaped)}`);
});

test("REGISTERS: only the measured ceiling moves, and the check can still see one", { skip }, () => {
  const stray = strayRegs(candidate);
  const control = strayRegs(brokenMovesSpareRegister);
  // An empty result is worth nothing on its own: the same measurement must report a register for a
  // twin that scribbles on one outside the ceiling, or it is not looking at registers at all.
  assert.ok(control.includes("b"), "the control twin scribbles B, yet the measurement misses it");
  assert.deepEqual(stray, [], "a register diverged outside the declared ceiling");
  console.log(`  REGISTERS: none stray past [${MOVED.join(", ")}]; the control twin strays ` +
    `[${control.join(", ")}]`);
});

for (const [label, brokenTwin, expected] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT on an exact count`, { skip }, () => {
    let caught = 0;
    for (const e of capture()) if (compare(brokenTwin, e).escaped) caught++;
    console.log(`  TEETH/${label}: caught on ${caught} of ${capture().length} dispatches`);
    assert.ok(caught > 0, `every dispatch PASSED the ${label} twin`);
    assert.equal(caught, expected, `the ${label} twin's catch count moved`);
  });
}
