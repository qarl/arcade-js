// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_3ecb — memory-equivalent to the frozen oracle at ROM 0x3ECB.
 *
 * GATE: crafted-entry with a MASKED diff. The rewrite calls the continuation directly instead
 *   of dispatching its address, so the frozen chain's nested calls — each pushing a return
 *   address and popping it again — have no counterpart, and the last of those returns is the
 *   one that carried this routine's own caller. Everything that leaves behind is inside the
 *   word-aligned window just below the stack pointer BOTH sides enter on, which is dead: the
 *   SCRATCH arm asserts the raw difference never reaches out of it, and the STACK arm pins the
 *   pointer's offset and the registers that move with it. No tooth is blunted by the mask —
 *   every twin is still caught on live cells, the one that skips the continuation included.
 *
 *   Crafted because the shared coin -> start tape never dispatches 0x3ECB: it is reached
 *   only from a conditional call inside the arm the per-record walk takes when a record's
 *   head byte is neither zero nor all-ones, and further only above a threshold the tape
 *   does not produce. The UNREACHED arm runs the tape with a counting hook and asserts
 *   zero. The entry is therefore a REAL machine, captured at a live dispatch of that walk,
 *   which leaves the index register on one of the records this routine writes through.
 *
 *   1. UNREACHED  — the tape really does not dispatch this address.
 *   2. EQUAL      — masked RAM identical on the crafted entry.
 *   3. SCRATCH    — the unmasked difference lies wholly inside the dead window, whose depth
 *                   is asserted so it cannot silently grow.
 *   4. STACK      — the rewrite ends exactly one word deeper than the frozen twin, and the
 *                   set of registers that move with it is pinned.
 *   5. CLAMPS     — the head byte really carries the constant afterwards, from any prior.
 *   6. EXHAUSTIVE — the head byte swept 0..255; the routine reads nothing, so together
 *                   with the fixed surroundings that is its whole input space.
 *   7. RECORDS    — repeated on each of the four records the walk uses, so the write is
 *                   not tied to the one the capture happened to leave behind.
 *   8. TEETH      — five broken twins, each caught OUTSIDE the window.
 *
 * HOLE: one captured machine, and it is the walk's dispatch rather than this routine's, so
 * the surrounding state is one it is never really called with. What the continuation does
 * depends on cells this file does not vary.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-3ecb.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { loc_3ecb } from "../loc_3ecb.js";
import { loc_3ecb as oracle } from "../../translated/loc_3ecb.js";
import { loc_3e63 as walk } from "../../translated/loc_3e63.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";

const TARGET = 0x3ecb;
const WALK = 0x3e63;
const skip = romsPresent() ? false : "ROM images are gitignored; none assembled";

const CLAMPED_TO = 0x3b;
const CONTINUATION = 0x5683;
/** The four records the walk steps through, sixteen bytes apart. */
const RECORDS = [0xa810, 0xa820, 0xa830, 0xa840];

/**
 * Bytes below the ENTRY stack pointer the frozen chain's nested calls scribble on and the rewrite
 * does not. The entry pointer, not the exit one, because it is the only depth both sides agree on
 * once the dissolved return has moved one of them. Measured; the SCRATCH arm re-measures it.
 */
const WINDOW = 8;
/**
 * The continuation's tail return becomes a JS return, so the word it would have popped stays on
 * the stack. One dissolved return, one word. The registers that move with it: the frozen chain
 * stages each sound code in the accumulator on its way to the request, while the rewrite hands it
 * over as an argument and never writes the register at all.
 */
const DISSOLVED_RET = 2;
const MOVED = ["a", "sp"];

let entry = null;

function entryState() {
  if (entry === null) {
    const ov = new Map([
      [WALK, (mm) => {
        if (entry === null) entry = mm.clone();
        return walk(mm);
      }],
    ]);
    makeMachine(ov).runFrames(ENTRY_FRAMES);
    assert.notEqual(entry, null, `the walk at 0x3e63 never dispatched in ${ENTRY_FRAMES}`);
  }
  return entry;
}

/** Oracle vs candidate on clones of the entry, with the record and its head byte set. */
function runAt(candidate, record, head) {
  const a = entryState().clone();
  const b = entryState().clone();
  for (const mm of [a, b]) {
    mm.regs.ix = record;
    mm.mem8[record] = head;
  }
  const entrySp = a.regs.sp;
  oracle(a);
  candidate(b);
  const da = a.dumpState();
  const db = b.dumpState();
  const all = [];
  for (let off = 0; off < da.length; off++) {
    if (da[off] !== db[off]) all.push({ addr: a.stateOffsetToAddr(off), a: da[off], b: db[off] });
  }
  const inWindow = (d) => d.addr >= entrySp - WINDOW && d.addr < entrySp;
  return {
    entrySp,
    spA: a.regs.sp,
    spB: b.regs.sp,
    all,
    masked: all.filter((d) => !inWindow(d)),
    moved: REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]),
  };
}

/** The first difference the window does NOT cover, or null when there is none. */
const diffAt = (candidate, record, head) => runAt(candidate, record, head).masked[0] ?? null;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

// ── broken twins ────────────────────────────────────────────────────────────────────────

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: off by one in the value clamped into the head byte. */
function brokenWrongValue(m) {
  m.mem8[m.regs.ix] = CLAMPED_TO - 1;
  m.call(CONTINUATION);
}

/** BUG: clamps the byte after the head instead of the head. */
function brokenWrongCell(m) {
  m.mem8[m.regs.ix + 1] = CLAMPED_TO;
  m.call(CONTINUATION);
}

/** BUG: clamps but never hands over. */
function brokenSkipsContinuation(m) {
  m.mem8[m.regs.ix] = CLAMPED_TO;
}

/** BUG: counts the head down instead of forcing it, which is the caller's idiom. */
function brokenSteps(m) {
  m.mem8[m.regs.ix] = m.mem8[m.regs.ix] - 1;
  m.call(CONTINUATION);
}

const TWINS = [
  ["no-op", brokenNoOp],
  ["wrong-value", brokenWrongValue],
  ["wrong-cell", brokenWrongCell],
  ["skips-continuation", brokenSkipsContinuation],
  ["steps-instead", brokenSteps],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("UNREACHED: the shared tape never dispatches this address", { skip }, () => {
  let hits = 0;
  let walkHits = 0;
  const ov = new Map([
    [TARGET, (mm) => { hits++; return oracle(mm); }],
    [WALK, (mm) => { walkHits++; return walk(mm); }],
  ]);
  makeMachine(ov).runFrames(ENTRY_FRAMES);
  assert.ok(walkHits > 0, "the counting hook is not wired: even the walk shows no hits");
  assert.equal(hits, 0, "the tape DOES reach this entry now — capture it instead of crafting");
  console.log(`  UNREACHED: 0 dispatches in ${ENTRY_FRAMES} frames (walk: ${walkHits})`);
});

test("EQUAL on the crafted entry: loc_3ecb == oracle on masked RAM", { skip }, () => {
  const e = entryState();
  assert.ok(RECORDS.includes(e.regs.ix), `entry base ${hex4(e.regs.ix)} is not a record base`);
  const d = diffAt(loc_3ecb, e.regs.ix, e.mem8[e.regs.ix]);
  assert.equal(d, null, `RAM diverged — ${show(d)}`);
  console.log(`  EQUAL: record ${hex4(e.regs.ix)}, masked RAM identical`);
});

test("SCRATCH: the whole raw difference lies inside the dead window", { skip }, () => {
  let deepest = 0;
  let seen = 0;
  for (const record of RECORDS) {
    for (const head of [0, 1, CLAMPED_TO, 0xff]) {
      const r = runAt(loc_3ecb, record, head);
      for (const d of r.all) {
        assert.ok(
          d.addr < r.entrySp,
          `record ${hex4(record)} head ${head}: ${hex4(d.addr)} is at or above the entry pointer`,
        );
        deepest = Math.max(deepest, r.entrySp - d.addr);
        seen++;
      }
    }
  }
  assert.ok(seen > 0, "no raw difference at all: the mask is not measuring anything");
  assert.ok(
    deepest <= WINDOW,
    `the deepest difference is ${deepest} bytes below the entry pointer, past the ${WINDOW}-` +
      "byte window this file masks — widen it deliberately, do not let it drift",
  );
  console.log(
    `  SCRATCH: ${seen} differing bytes, deepest ${deepest} below the entry pointer, window ${WINDOW}`,
  );
});

test("STACK: the rewrite ends exactly two bytes deeper, and the moved set is pinned", { skip }, () => {
  for (const record of RECORDS) {
    for (const head of [0, CLAMPED_TO, 0xff]) {
      const r = runAt(loc_3ecb, record, head);
      assert.equal(
        r.spA - r.spB,
        DISSOLVED_RET,
        `record ${hex4(record)} head ${head}: exit pointers ${hex4(r.spA)} and ${hex4(r.spB)} ` +
          `are ${r.spA - r.spB} bytes apart, not ${DISSOLVED_RET} — the rewrite is moving the ` +
          "stack for some reason other than the one dissolved return",
      );
      assert.deepEqual(
        r.moved,
        MOVED,
        `record ${hex4(record)} head ${head}: the moved register set changed shape`,
      );
    }
  }
  console.log(`  STACK: ${DISSOLVED_RET} bytes deeper everywhere, and only ${MOVED.join(", ")} move`);
});

test("CLAMPS: the head byte carries the constant afterwards, from any prior", { skip }, () => {
  for (const prior of [0, 1, CLAMPED_TO, CLAMPED_TO + 1, 0xfe, 0xff]) {
    const mm = entryState().clone();
    mm.mem8[mm.regs.ix] = prior;
    loc_3ecb(mm);
    assert.equal(mm.mem8[mm.regs.ix], CLAMPED_TO, `prior ${prior} did not land on the constant`);
  }
  console.log(`  CLAMPS: head byte -> ${CLAMPED_TO} from every prior tried`);
});

test("EXHAUSTIVE: every head byte 0..255 behaves the same way", { skip }, () => {
  const record = entryState().regs.ix;
  let swept = 0;
  for (let head = 0; head < 256; head++) {
    const d = diffAt(loc_3ecb, record, head);
    assert.equal(d, null, `head=${head}: ${show(d)}`);
    swept++;
  }
  assert.equal(swept, 256, "must have swept every head byte");
  console.log(`  EXHAUSTIVE: ${swept} head bytes identical`);
});

test("RECORDS: the same holds on each record the walk uses", { skip }, () => {
  for (const record of RECORDS) {
    for (const head of [0, 1, 0x3c, 0xff]) {
      const d = diffAt(loc_3ecb, record, head);
      assert.equal(d, null, `record ${hex4(record)} head ${head}: ${show(d)}`);
    }
    const mm = entryState().clone();
    mm.regs.ix = record;
    loc_3ecb(mm);
    assert.equal(mm.mem8[record], CLAMPED_TO, `record ${hex4(record)} was not clamped`);
  }
  console.log(`  RECORDS: ${RECORDS.length} records, each clamped and each identical`);
});

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT outside the window`, { skip }, () => {
    const record = entryState().regs.ix;
    const caught = [];
    for (let head = 0; head < 256; head++) if (diffAt(twin, record, head)) caught.push(head);
    assert.ok(
      caught.length > 0,
      `the masked sweep PASSED the ${label} twin on every head byte — either the twin is not ` +
        "broken or the window has swallowed the evidence",
    );
    console.log(`  TEETH/${label}: caught on ${caught.length} head bytes, first ${caught[0]}`);
  });
}
