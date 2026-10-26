// SPDX-License-Identifier: GPL-3.0-only
/**
 * fileTwoPairsIntoObjectRecordHighByteFirst — memory-equivalent to the frozen oracle at ROM 0x46CE.
 *
 * WHAT IT IS. Four stores into an object's record: one register pair into two adjacent slots, a
 * second pair into two more sixteen slots further on, each high byte first. It reads nothing.
 *
 * ★ THE ENTRY IS REACHED BY A PUSHED RETURN, NOT A CALL. Nothing in the image writes
 *   `call 0x46CE`; the dispatcher above it pushes this address and lets a table arm's own return
 *   land here. A tape reaches it exactly ONCE in the corpus budget, which the corpus arm asserts,
 *   so the crafted sweep is where the teeth are.
 *
 * GATE: strict unit-capture at the one real dispatch, an exhaustive sweep of the four bytes it
 *   files and of the record base, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM byte-identical with nothing masked; neither side writes
 *      the stack, and the arm asserts that by masking nothing.
 *   2. NOT VACUOUS — a candidate that does nothing FAILS in the crafted space, and the arm reports
 *      whether it also fails at the single real dispatch rather than assuming it.
 *   3. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      space is exactly {sp}: this entry leaves the register file otherwise untouched.
 *   4. CORPUS — the one real dispatch replayed, with the count asserted.
 *   5. CRAFTED — five values on each of the four bytes, crossed, on three record bases.
 *   6. WHOLE-MACHINE — the attract session with the rewrite wired through the omitted-return seam.
 *   7. TEETH — five twins at five distinct layouts of the same four bytes, with exact counts. Two
 *      of the five are NOT caught by the one real dispatch and three are; with a corpus of one
 *      that is a coin toss, which is the honest reason the crafted counts are the ones that matter.
 *
 * HOLE: one real dispatch is one sample. Whether some other caller reaches this entry with a
 * record base that behaves differently is not covered by the corpus; the crafted bases are what
 * stand in for that, and they are chosen rather than observed.
 * HOLE: the rewrite wraps the slot address at sixteen bits. No base reachable here can make that
 * wrap happen — every record lives in work RAM, far from the end of the address space — so the
 * wrap is faithful by construction and NOT exercised by any arm.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-46ce.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { fileTwoPairsIntoObjectRecordHighByteFirst } from "../fileTwoPairsIntoObjectRecordHighByteFirst.js";
import { loc_46ce as oracle } from "../../translated/loc_46ce.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x46ce;

const FIRST_PAIR_SLOT = 12;
const SECOND_PAIR_SLOT = 28;

const EXCLUDED = ["sp"];
const CORPUS_FRAMES = 4000;
const DISPATCHES = 1;
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

function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]), ATTRACT);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught };
}

let cache = null;
const session = () => (cache ??= replaySession(fileTwoPairsIntoObjectRecordHighByteFirst));

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

/** A real captured machine with the four filed bytes and the record base forced. */
function craft(record, first, second) {
  const m = entryState().clone();
  m.regs.ix = record;
  m.regs.d = first[0];
  m.regs.e = first[1];
  m.regs.b = second[0];
  m.regs.c = second[1];
  return m;
}

const BYTES = [0, 1, 0x7f, 0x80, 0xff];
/** Two chosen work-RAM bases and the real one, so the slot offsets are exercised off three. */
const BASES = [0xa800, 0xaa00, null];
const SWEEP_SIZE = BASES.length * BYTES.length * BYTES.length * BYTES.length * BYTES.length;

function overSweep(fn) {
  for (const base of BASES) {
    const record = base ?? entryState().regs.ix;
    for (const d of BYTES) {
      for (const e of BYTES) {
        for (const b of BYTES) {
          for (const c of BYTES) fn(craft(record, [d, e], [b, c]));
        }
      }
    }
  }
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
  const floors = recordFrameFloors(host);
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
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const at = (m, slot) => (m.regs.ix + slot) & 0xffff;

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: each pair goes in low byte first, which is how a word would be stored. */
function brokenWordOrder(m) {
  m.mem8[at(m, FIRST_PAIR_SLOT)] = m.regs.e;
  m.mem8[at(m, FIRST_PAIR_SLOT + 1)] = m.regs.d;
  m.mem8[at(m, SECOND_PAIR_SLOT)] = m.regs.c;
  m.mem8[at(m, SECOND_PAIR_SLOT + 1)] = m.regs.b;
}

/** BUG: the two pairs are filed in each other's slots. */
function brokenPairsSwapped(m) {
  m.mem8[at(m, FIRST_PAIR_SLOT)] = m.regs.b;
  m.mem8[at(m, FIRST_PAIR_SLOT + 1)] = m.regs.c;
  m.mem8[at(m, SECOND_PAIR_SLOT)] = m.regs.d;
  m.mem8[at(m, SECOND_PAIR_SLOT + 1)] = m.regs.e;
}

/** BUG: the far pair lands one slot short of where it belongs. */
function brokenSecondSlotOffByOne(m) {
  m.mem8[at(m, FIRST_PAIR_SLOT)] = m.regs.d;
  m.mem8[at(m, FIRST_PAIR_SLOT + 1)] = m.regs.e;
  m.mem8[at(m, SECOND_PAIR_SLOT - 1)] = m.regs.b;
  m.mem8[at(m, SECOND_PAIR_SLOT)] = m.regs.c;
}

/** BUG: only the near pair is filed. */
function brokenNearPairOnly(m) {
  m.mem8[at(m, FIRST_PAIR_SLOT)] = m.regs.d;
  m.mem8[at(m, FIRST_PAIR_SLOT + 1)] = m.regs.e;
}

const TWINS = [
  ["no-op", brokenNoOp, 1874, 1],
  ["word-order", brokenWordOrder, 1800, 1],
  ["pairs-swapped", brokenPairsSwapped, 1800, 1],
  ["second-slot-off-by-one", brokenSecondSlotOffByOne, 1850, 0],
  ["near-pair-only", brokenNearPairOnly, 1850, 0],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: fileTwoPairsIntoObjectRecordHighByteFirst == oracle on the WHOLE dump", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  fileTwoPairsIntoObjectRecordHighByteFirst(b);
  assert.deepEqual(allDiffs(a, b), [], "RAM diverged with nothing masked");
  console.log(`  EQUAL: record=${hex4(entryState().regs.ix)}; identical, stack bytes included`);
});

test("NOT VACUOUS: a no-op candidate FAILS, and the arm says where", { skip }, () => {
  const crafted = sweepCaught(brokenNoOp);
  assert.ok(crafted > 0, "the diff passed a candidate that does nothing, everywhere");
  const atReal = unitDiff(brokenNoOp, entryState()) !== null;
  console.log(
    `  NOT VACUOUS: the empty candidate is caught on ${crafted} of ${SWEEP_SIZE} crafted entries ` +
      `and ${atReal ? "also" : "NOT"} at the one real dispatch`,
  );
});

test("EXCLUDED, deliberately: pinned over the whole crafted space", { skip }, () => {
  assert.deepEqual(movedRegisters(fileTwoPairsIntoObjectRecordHighByteFirst), EXCLUDED, "the excluded set changed shape");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc — nothing else moves`);
});

test("CORPUS: the real dispatches replay identically, and there is exactly one", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(s.caught, 0, "the rewrite diverged on a real dispatch");
  console.log(`  CORPUS: ${s.dispatches} real dispatch, identical`);
});

test("CRAFTED: four bytes swept on three record bases, one of which wraps", { skip }, () => {
  assert.equal(sweepCaught(fileTwoPairsIntoObjectRecordHighByteFirst), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  CRAFTED: ${SWEEP_SIZE} comparisons identical`);
});

test("WHOLE-MACHINE: the attract session differs only where the interrupt pushes", { skip }, () => {
  const r = wholeRunCells(fileTwoPairsIntoObjectRecordHighByteFirst);
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
  assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the interrupt's own push");
  console.log(`  WHOLE-MACHINE: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`);
});

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
