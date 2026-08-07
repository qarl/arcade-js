// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_4809 — memory-equivalent to the frozen oracle at ROM 0x4809.
 *
 * WHAT IT IS. Put an object into a fixed state, ask for the sound that goes with it, and dress its
 * sprite entry from a four-entry shape table chosen by a byte of the object's own record — with a
 * single fixed shape used instead when that byte is at or past the end of the table. The sound
 * request and the table fetch are BOTH already decompiled, so the rewrite calls loc_57ff and
 * fetchTableByte directly and dissolving those two transfers belongs to this caller's unit.
 *
 * ★ THE CLAMP IS THE INTERESTING PART AND NO TAPE EXERCISES IT. Undriven attract dispatches this
 *   entry twice in the corpus budget, both with an index inside the table, which the corpus arm
 *   asserts. Everything the file says about the out-of-range arm rests on the crafted sweep, and
 *   the per-twin counts show exactly which twins that makes invisible to the corpus.
 *
 * GATE: strict unit-capture at both real dispatches, an EXHAUSTIVE sweep of the index, and a
 *   whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatches — RAM identical outside the dead stack bytes.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS the same masked comparison.
 *   3. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      sweep, asserted as a set.
 *   4. CORPUS — both real dispatches replayed, with the count and the index they present asserted.
 *   5. EXHAUSTIVE — all 256 index values against BOTH states of the permission cell the sound
 *      request consults. The arm covers every table entry, the first value past the end, and the
 *      whole range beyond it; the permission dimension is what makes the sound observable at all,
 *      and its own arm measures that a silent twin is invisible without it.
 *   6. WHOLE-MACHINE — the attract session with the rewrite wired through the omitted-return seam.
 *   7. TEETH — seven twins, with exact catch counts over the crafted space and the real session.
 *
 * HOLE: the corpus is two dispatches. A twin caught by them is caught by a sample of two.
 * HOLE: nothing here says what the state code or the shapes MEAN. A wrong belief about either
 * would not fail any arm, because every arm compares this entry against the oracle and not
 * against the game.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-4809.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { loc_4809 } from "../loc_4809.js";
import { loc_57ff } from "../loc_57ff.js";
import { PLAY_ACTIVE } from "../names.js";
import { loc_4809 as oracle } from "../../translated/loc_4809.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x4809;

const STATE_IN_RECORD = 0;
const INDEX_IN_RECORD = 7;
const STATE_CODE = 0x3b;
const SHAPE_TABLE = 0x482d;
const SHAPE_TABLE_LENGTH = 4;
const SHAPE_PAST_THE_END = 0x8f;
const SHAPE_IN_ENTRY = 1;
const SECOND_BYTE_IN_ENTRY = 48;
const SECOND_BYTE = 0x6c;

/**
 * The dead window under the stack pointer. EIGHT bytes: the sound request nests three further
 * calls when play is active, which no attract dispatch reaches, so the depth is measured in the
 * crafted space and the SCRATCH DEPTH arm asserts it there.
 */
const SCRATCH_BYTES = 8;
const SCRATCH_OFFSETS = [-8, -7, -6, -5, -4, -3, -2, -1];
const EXCLUDED = ["a", "f", "sp"];

const CORPUS_FRAMES = 4000;
const DISPATCHES = 2;
const ATTRACT = { tape: [] };

/** The only cells a whole session leaves differing: where the frame interrupt pushes. Measured. */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

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

function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const indices = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    indices.add(mm.mem8[(mm.regs.ix + INDEX_IN_RECORD) & 0xffff]);
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]), ATTRACT);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, indices };
}

let cache = null;
const session = () => (cache ??= replaySession(loc_4809));

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]), ATTRACT);
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the attract session never reached the routine");
  return entry;
}

function craft(index, active) {
  const m = entryState().clone();
  m.mem8[(m.regs.ix + INDEX_IN_RECORD) & 0xffff] = index;
  m.mem8[PLAY_ACTIVE] = active;
  return m;
}

const INDICES = Array.from({ length: 256 }, (_unused, i) => i);
const PLAY_STATES = [0, 1];
const SWEEP_SIZE = INDICES.length * PLAY_STATES.length;

function overSweep(fn) {
  for (const active of PLAY_STATES) for (const index of INDICES) fn(craft(index, active));
}

function sweepCaught(candidate) {
  let caught = 0;
  overSweep((machine) => {
    if (unitDiff(candidate, machine)) caught++;
  });
  return caught;
}

function movedRegisters(candidate) {
  const moved = new Set();
  overSweep((machine) => {
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    candidate(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  });
  return REG_FIELDS.filter((k) => moved.has(k));
}

function wholeRunCells(candidate) {
  const base = makeMachine(undefined, ATTRACT);
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(
    new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]),
    ATTRACT,
  );
  let hostFrames = [];
  let threw = null;
  try {
    hostFrames = host.runFrames(CORPUS_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(baseFrames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    for (let o = 0; o < baseFrames[i].length; o++) {
      if (baseFrames[i][o] !== hostFrames[i][o]) cells.add(base.stateOffsetToAddr(o));
    }
  }
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const record = (m, slot) => (m.regs.ix + slot) & 0xffff;
const sprite = (m, slot) => (m.regs.iy + slot) & 0xffff;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the index is not clamped, so an out-of-range one reads on past the table. */
function brokenNoClamp(m) {
  m.mem8[record(m, STATE_IN_RECORD)] = STATE_CODE;
  loc_57ff(m);
  const index = m.mem8[record(m, INDEX_IN_RECORD)];
  m.mem8[sprite(m, SHAPE_IN_ENTRY)] = m.mem8[(SHAPE_TABLE + index) & 0xffff];
  m.mem8[sprite(m, SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}

/** BUG: the range test is off by one, so the last table entry is never used. */
function brokenRangeOffByOne(m) {
  body(m, m.mem8[record(m, INDEX_IN_RECORD)] < SHAPE_TABLE_LENGTH - 1, 0);
}

/** BUG: the table starts one entry on. */
function brokenTableOffByOne(m) {
  body(m, m.mem8[record(m, INDEX_IN_RECORD)] < SHAPE_TABLE_LENGTH, 1);
}

/** BUG: the sound that goes with the state change is never asked for. */
function brokenSilent(m) {
  m.mem8[record(m, STATE_IN_RECORD)] = STATE_CODE;
  const index = m.mem8[record(m, INDEX_IN_RECORD)];
  m.mem8[sprite(m, SHAPE_IN_ENTRY)] =
    index < SHAPE_TABLE_LENGTH ? m.mem8[SHAPE_TABLE + index] : SHAPE_PAST_THE_END;
  m.mem8[sprite(m, SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}

/** BUG: the state code is one out. */
function brokenWrongState(m) {
  m.mem8[record(m, STATE_IN_RECORD)] = STATE_CODE + 1;
  loc_57ff(m);
  const index = m.mem8[record(m, INDEX_IN_RECORD)];
  m.mem8[sprite(m, SHAPE_IN_ENTRY)] =
    index < SHAPE_TABLE_LENGTH ? m.mem8[SHAPE_TABLE + index] : SHAPE_PAST_THE_END;
  m.mem8[sprite(m, SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}

/** BUG: the out-of-range shape is used for everything. */
function brokenAlwaysFallback(m) {
  m.mem8[record(m, STATE_IN_RECORD)] = STATE_CODE;
  loc_57ff(m);
  m.mem8[sprite(m, SHAPE_IN_ENTRY)] = SHAPE_PAST_THE_END;
  m.mem8[sprite(m, SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}

function body(m, inRange, tableShift) {
  m.mem8[record(m, STATE_IN_RECORD)] = STATE_CODE;
  loc_57ff(m);
  const index = m.mem8[record(m, INDEX_IN_RECORD)];
  m.mem8[sprite(m, SHAPE_IN_ENTRY)] = inRange
    ? m.mem8[(SHAPE_TABLE + tableShift + index) & 0xffff]
    : SHAPE_PAST_THE_END;
  m.mem8[sprite(m, SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}

const TWINS = [
  ["no-op", brokenNoOp, 512, 2],
  ["no-clamp", brokenNoClamp, 504, 0],
  ["range-off-by-one", brokenRangeOffByOne, 2, 0],
  ["table-off-by-one", brokenTableOffByOne, 8, 2],
  ["silent", brokenSilent, 256, 0],
  ["wrong-state", brokenWrongState, 512, 2],
  ["always-fallback", brokenAlwaysFallback, 8, 2],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: loc_4809 == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  loc_4809(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  console.log(
    `  EQUAL: index=${entryState().mem8[(entryState().regs.ix + INDEX_IN_RECORD) & 0xffff]}; identical`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: pinned over the whole crafted space", { skip }, () => {
  assert.deepEqual(movedRegisters(loc_4809), EXCLUDED, "the excluded set changed shape");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("CORPUS: both real dispatches replay identically, and both are in range", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  assert.ok(
    [...s.indices].every((i) => i < SHAPE_TABLE_LENGTH),
    "a real dispatch now presents an out-of-range index, so the clamp is no longer crafted-only " +
      "and the per-twin real counts have to be re-derived",
  );
  console.log(`  CORPUS: ${s.dispatches} real dispatches, indices ${[...s.indices].join(",")}`);
});

test("SCRATCH DEPTH: the crafted space dirties exactly eight bytes under the stack pointer", { skip }, () => {
  const offsets = new Set();
  overSweep((machine) => {
    const sp = machine.regs.sp;
    const a = machine.clone();
    const b = machine.clone();
    oracle(a);
    loc_4809(b);
    for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) offsets.add(d.addr - sp);
  });
  assert.deepEqual(
    [...offsets].sort((x, y) => x - y),
    SCRATCH_OFFSETS,
    "the dead window changed depth, so the mask every other arm uses is the wrong size",
  );
  console.log(`  SCRATCH DEPTH: offsets ${SCRATCH_OFFSETS.join(" ")} relative to the entry pointer`);
});

test("EXHAUSTIVE: 256 indices against both states of the sound permission", { skip }, () => {
  assert.equal(sweepCaught(loc_4809), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} comparisons identical, clamp included`);
});

test("THE SOUND IS INVISIBLE UNLESS PLAY IS ACTIVE, MEASURED", { skip }, () => {
  const active = unitDiff(brokenSilent, craft(0, 1));
  const inactive = unitDiff(brokenSilent, craft(0, 0));
  assert.notEqual(active, null, "with play active a silent twin must be caught");
  assert.equal(
    inactive,
    null,
    "the silent twin is now caught with play inactive too, so this file's reason for sweeping " +
      "that cell is stale",
  );
  console.log("  SOUND: the silent twin is caught only once play is active — which attract is not");
});

test("WHOLE-MACHINE: the attract session differs only where the interrupt pushes", { skip }, () => {
  const r = wholeRunCells(loc_4809);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the interrupt's own push");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, realCaught] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const r = replaySession(twin);
    assert.equal(r.dispatches, DISPATCHES, "the session's dispatch count moved");
    assert.equal(r.caught, realCaught, `the ${label} twin's real catch count moved`);
    console.log(`  TEETH/${label}: the real session catches ${r.caught} of ${r.dispatches}`);
  });
}
