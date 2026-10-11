// SPDX-License-Identifier: GPL-3.0-only
/**
 * fileScoreIntoHighScoreTable — high-score insertion, reached only at game over so neither tape dispatches it. Entries
 * are CRAFTED: a real machine's RAM with a seated descending board and a candidate score. Frozen side
 * vs rewrite on independent clones, RAM diffed outside the masked stack scratch. The frogger standard
 * applies: RAM is the whole contract, and only genuine named live-outs are pinned beside it. Here the
 * board and the two saved pointers are RAM, so the ONE further live-out is the oracle's carry — clear
 * when filed, set when dropped — which the rewrite RETURNS, checked on its own; every other register
 * the body touches is dead-after-return scratch and pinned to nothing (GENUINE_LIVE_OUTS empty). A
 * scratch-not-pinned control proves the reading: a twin that only scribbles a scratch register passes
 * by design, while a scribbled RAM cell is still caught.
 * HAND-OFF: the carry is read back, so the rewrite drops it from the registers only because every
 * reader is an override that takes the return — measured on the ORACLE over the tape sessions, the
 * callers that hear F complemented at this exit are exactly CARRY_READERS, each owned by a ROUTINES
 * entry, with the SP flip at the same exit heard. HOLE: a reader reached only in a state no session
 * drives is not measured. Run: node --test this file.
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { fileScoreIntoHighScoreTable as candidate } from "../fileScoreIntoHighScoreTable.js";
import { loc_4cc3 as frozen } from "../../translated/loc_4cc3.js";
import { F_C } from "../../../../core/cpu/z80.js";
import { TAPE_SESSIONS, handOffReaders, heardAs } from "./_deadAtExit.js";
import { ROUTINES } from "../names.js";

const ACTIVE_PLAYER = 0xad32;
const P1_SCORE = 0xad35;
const P2_SCORE = 0xad38;
const BOARD_SCORE = 0xab0b;
const RANK_COLUMN = 0xab08;
const SLOT_PTR = 0xa991;
const RECORD_STRIDE = 8;
const RECORD_COUNT = 5;
const BASE_FRAME = 900;

// Every game write is at or below here; the stack seats above it, so masking the scratch window
// can never hide a data divergence. Proved against the measured floor in the EQUAL arm.
const DATA_TOP = 0xadff;

// The frozen side rides its ret (sp drifts two) and, on the dropped-score path, the shared compare
// leaves f where the rewrite does not. RAM (masked over the stack scratch) is the contract; the sole
// register-file live-out is carry, checked on its own. No full register is a genuine live-out.
const GENUINE_LIVE_OUTS = [];

const TARGET = 0x4cc3;
/** Return address of each caller that reads the carry -> the override owning that code. The one
 *  call is `call 0x4cc3` at 0x3310 inside fileScoreAfterGameOverHoldElsePassTurn (0x330B), then `jp nc`. */
const CARRY_READERS = new Map([[0x3313, [0x330b]]]);
const HANDOFF_FRAMES = 2500;
/** The helper's exit control runs on the first session; game over is the one that files a score. */
const HANDOFF_SESSIONS = [...TAPE_SESSIONS].sort((p, q) => (q.label === "high-score") - (p.label === "high-score"));

// The default board, descending packed decimal.
const BOARD = [10000, 8800, 8460, 6520, 4300];

const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

let baseCache = null;
function base() {
  if (!baseCache) {
    baseCache = makeMachine();
    baseCache.runFrames(BASE_FRAME);
  }
  return baseCache;
}

function bcd(n) {
  const s = n.toString().padStart(6, "0");
  return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
}

function seat(m, ptr, score) {
  const [msb, mid, lsb] = bcd(score);
  m.mem8[ptr] = msb;
  m.mem8[(ptr - 1) & 0xffff] = mid;
  m.mem8[(ptr - 2) & 0xffff] = lsb;
}

function craft({ player = 0, score }) {
  const m = base().clone();
  m.mem8[ACTIVE_PLAYER] = player;
  for (let r = 0; r < RECORD_COUNT; r++) seat(m, BOARD_SCORE + r * RECORD_STRIDE, BOARD[r]);
  seat(m, player ? P2_SCORE : P1_SCORE, score);
  return m;
}

// [label, input, filed?]
const SCENARIOS = [
  ["insert-top", { score: 12000 }, true],
  ["insert-2nd", { score: 9000 }, true],
  ["insert-3rd", { score: 8500 }, true],
  ["insert-4th", { score: 7000 }, true],
  ["insert-last", { score: 5700 }, true],
  ["equal-top", { score: 10000 }, true],
  ["equal-last", { score: 4300 }, true],
  ["player-two", { player: 1, score: 8500 }, true],
  ["dropped", { score: 3000 }, false],
];
const INSERTS = SCENARIOS.filter(([, , filed]) => filed);

// ── the masked comparison (frogger standard) ─────────────────────────────────────────────────
//
// Frozen vs candidate on independent clones. The frozen side drops a ret and scrambles the scratch
// registers, so RAM is diffed outside [low, seat) — low measured by watching the frozen side's own
// pushes — the candidate's returned answer is checked against the frozen side's carry, and only genuine
// full-register live-outs are pinned (none here).
function compare(cand, m) {
  const a = m.clone();
  const b = m.clone();
  const seatSp = a.regs.sp;
  let low = seatSp;
  const push = a.push16.bind(a);
  a.push16 = (v) => {
    push(v);
    if (a.regs.sp < low) low = a.regs.sp;
  };
  frozen(a);
  let answer;
  try {
    answer = cand(b);
  } catch (e) {
    return { escaped: { addr: null }, liveOut: null, carryOk: false, threw: String(e).slice(0, 40) };
  }
  const da = a.dumpState();
  const db = b.dumpState();
  let escaped = null;
  for (let i = 0; i < da.length && escaped === null; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (addr >= low && addr < seatSp) continue;
    escaped = { addr, a: da[i], b: db[i] };
  }
  let liveOut = null;
  for (const k of GENUINE_LIVE_OUTS) {
    if (a.regs[k] !== b.regs[k]) { liveOut = { k, a: a.regs[k], b: b.regs[k] }; break; }
  }
  const carryOk = ((a.regs.f & F_C) !== 0) === answer;
  return { escaped, liveOut, carryOk, low, seat: seatSp, spDiff: a.regs.sp - b.regs.sp };
}
const caught = (r) => r.escaped !== null || r.liveOut !== null || !r.carryOk;

function footprint(m) {
  const before = m.dumpState().slice();
  const a = m.clone();
  frozen(a);
  const now = a.dumpState();
  let n = 0;
  for (let i = 0; i < now.length; i++) {
    if (now[i] !== before[i] && a.stateOffsetToAddr(i) <= DATA_TOP) n++;
  }
  return n;
}

// ── broken twins ────────────────────────────────────────────────────────────────────────────

/** BUG: files nothing, so an insert's whole footprint is missing. */
function brokenNoOp() {}

/** BUG: corrupts a blanked name cell of the freed slot. */
function brokenWrongSentinel(m) {
  const dropped = candidate(m);
  const slot = m.mem.read16(SLOT_PTR);
  m.mem8[slot] ^= 0xff;
  return dropped;
}

/** BUG: renumbers the rank column 1..5 instead of 0..4. */
function brokenWrongRank(m) {
  const dropped = candidate(m);
  for (let r = 0; r < RECORD_COUNT; r++) m.mem8[RANK_COLUMN + r * RECORD_STRIDE] = r + 1;
  return dropped;
}

// ── scratch-not-pinned controls: a register-only twin passes by design; RAM still bites ────────
/** A scratch register moved after the routine — DELIBERATELY not flagged, since no full register is a
 *  genuine live-out. */
function scribbleScratchReg(m) {
  const dropped = candidate(m);
  m.regs.b = (m.regs.b + 1) & 0xff;
  return dropped;
}
/** A scribbled RAM cell — the same measurement MUST catch this, or the clean read above is worthless. */
function scribbleData(m) {
  const dropped = candidate(m);
  m.mem8[RANK_COLUMN] ^= 0xff;
  return dropped;
}

function caughtInMemory(cand) {
  return INSERTS.filter(([, input]) => compare(cand, craft(input)).escaped !== null).length;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────────

test("EQUAL: every crafted scenario is RAM-identical, the answer is the carry, sp re-seats by two", { skip }, () => {
  for (const [label, input] of SCENARIOS) {
    const r = compare(candidate, craft(input));
    assert.equal(r.escaped, null, `${label}: escaped at ${r.escaped && hex4(r.escaped.addr)}`);
    assert.equal(r.liveOut, null, `${label}: live-out ${r.liveOut && r.liveOut.k} diverged`);
    assert.ok(r.carryOk, `${label}: the carry live-out diverged`);
    assert.equal(r.spDiff, 2, `${label}: the frozen ret no longer re-seats two bytes`);
    // ★ The mask is safe only if it never covers a data cell.
    assert.ok(r.low > DATA_TOP, `${label}: the stack window ${hex4(r.low)} reached into game data`);
  }
  console.log(`  EQUAL: ${SCENARIOS.length} scenarios identical, spDiff 2, mask floor above data`);
});

test("PATHS: an insert writes the board, a dropped score writes nothing", { skip }, () => {
  for (const [label, input] of INSERTS) {
    assert.ok(footprint(craft(input)) > 0, `${label}: the insert path wrote nothing`);
  }
  const dropped = SCENARIOS.find(([, , filed]) => !filed);
  assert.equal(footprint(craft(dropped[1])), 0, "the dropped-score path wrote to game data");
  console.log(`  PATHS: ${INSERTS.length} inserts write, the dropped score writes 0`);
});

test("SCRATCH NOT PINNED: a register-only twin passes; a RAM scribble is caught", { skip }, () => {
  // No genuine full-register live-outs, so a twin that only scribbles a scratch register after the
  // routine is DELIBERATELY not flagged — and the same measurement must still catch a scribbled RAM
  // cell, or the clean read on the register twin would be worthless.
  for (const [label, input] of SCENARIOS) {
    assert.ok(!caught(compare(scribbleScratchReg, craft(input))),
      `${label}: a scratch-register scribble was flagged, but no full register is a genuine live-out`);
    const r = compare(scribbleData, craft(input));
    assert.ok(caught(r), `${label}: the RAM measurement missed a scribbled cell, so it has no teeth`);
    assert.notEqual(r.escaped, null, `${label}: the RAM scribble must be caught on a cell, not a register`);
  }
  console.log(`  SCRATCH NOT PINNED: register twin ignored; RAM twin caught on all ${SCENARIOS.length}`);
});

const MEMORY_TWINS = [
  ["no-op", brokenNoOp],
  ["wrong-sentinel", brokenWrongSentinel],
  ["wrong-rank", brokenWrongRank],
];

for (const [label, twin] of MEMORY_TWINS) {
  test(`TEETH: the ${label} twin is caught IN MEMORY on every insert`, { skip }, () => {
    const c = caughtInMemory(twin);
    assert.equal(c, INSERTS.length, `the ${label} twin escaped the memory diff on an insert`);
    console.log(`  TEETH/${label}: caught in memory on ${c}/${INSERTS.length} inserts`);
  });
}

test("TEETH: the answer live-out has teeth, and the real rewrite is clean", { skip }, () => {
  // Invert the answer: the carry check must catch it, proving the pin is not vacuous, while the real
  // rewrite diverges on nothing across every scenario.
  const flipCarry = (m) => !candidate(m);
  let carryCaught = 0;
  let real = 0;
  for (const [, input] of SCENARIOS) {
    if (!compare(flipCarry, craft(input)).carryOk) carryCaught++;
    if (caught(compare(candidate, craft(input)))) real++;
  }
  assert.equal(carryCaught, SCENARIOS.length, "the carry-flip control slipped a scenario");
  assert.equal(real, 0, "the real rewrite was flagged on a scenario");
  console.log(`  TEETH/carry: control caught ${carryCaught}/${SCENARIOS.length}, real rewrite ${real}`);
});

test("HAND-OFF: every caller that reads the carry is an override that takes the return", { skip }, () => {
  const { callers, readers, exitControl } = handOffReaders({
    at: TARGET, poison: ["f"], sessions: HANDOFF_SESSIONS, frames: HANDOFF_FRAMES,
  });
  assert.ok(callers.size > 0, "vacuous: no session filed a score");
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
