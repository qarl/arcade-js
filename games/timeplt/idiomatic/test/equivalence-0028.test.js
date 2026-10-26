// SPDX-License-Identifier: GPL-3.0-only
/**
 * retreatCharCursor — memory-equivalent to the frozen oracle at ROM 0x0028.
 *
 * GATE: unit-capture at the real dispatch, comparing RAM **plus a declared live-out**, because
 *   RAM ALONE IS VACUOUS HERE. The routine writes no memory at all: `unitEquivalence` reports
 *   `ram: null` for a bare `() => {}` exactly as readily as for the real thing, so a test
 *   asserting only that would be green and worthless. The BLIND arm makes that an assertion
 *   rather than a caveat, and every arm with teeth compares the cursor.
 *
 * LIVE-OUT is the cursor pair {d, e}, read off the seven call sites in five routines. Each site
 *   holds a tilemap address there across the call and a character code is written through it —
 *   directly after the call at 0x0E76, 0x0E82, 0x0EB7 and 0x0EB8, or by whoever called the
 *   routine that ends on the step at 0x0E9A, 0x0EAA and 0x0F04. The accumulator is NOT live at
 *   the three sites that reload it within two instructions; at the four tail sites it flows out
 *   through a return, and reading further would mean walking the call graph rather than the
 *   callers, so MEASUREMENT finishes the derivation — see LIVE-OUT (MEASURED). No site tests the
 *   flags this routine leaves before overwriting them. EXCLUDED is therefore {a, f, sp}, pinned
 *   by name so it cannot silently widen, and `pc` diverges too: the oracle ends by popping a
 *   return address into it and the rewrite, being ordinary JavaScript, does not.
 *
 * THE STACK IS NOT MODELLED, AND THAT COSTS SOMETHING MEASURABLE. Substituting this leaf
 *   one-for-one into the still-translated engine leaks two bytes per dispatch, and the engine
 *   follows a stale return address into unwritten space on the very frame it first draws
 *   characters. That is the known mixed-migration leak, not a defect here, and it resolves when
 *   the callers stop pushing. EXPECTED DIVERGENCE pins it as a measurement rather than a claim,
 *   and LIVE-OUT (MEASURED) shows the leak is the ONLY thing the missing return was buying.
 *
 * `r.equal` is never asserted: it folds in the register diff that memory-equivalence deliberately
 *   drops, so it is false for a CORRECT routine.
 *
 * What it exercises, holes stated:
 *   1. BLIND — the RAM half is proven vacuous, so it cannot be mistaken for the gate.
 *   2. EQUAL at the real dispatch — RAM identical AND the live-out identical.
 *   3. EXCLUDED — nothing outside {a, f, sp} moves, plus pc; the cursor does not.
 *   4. DIRECTION — the step measured in PIXELS. A character painted through the stepped cursor
 *      lands one whole cell along the grid from one painted through the cursor as captured,
 *      which is what licenses calling this a one-cell step rather than an address bump.
 *   5. EXHAUSTIVE — all 65536 cursor values. The routine reads nothing else, so that is its
 *      entire input space, and it is the only arm that covers the carry into the high byte.
 *   6. CORPUS — every cursor the running game really presents over a driven tape, replayed, and
 *      confirmed to be a video-RAM address at every one of them.
 *   7. EXPECTED DIVERGENCE — the stack leak, measured and recorded.
 *   8. LIVE-OUT (MEASURED) — the dropped accumulator and flags reach nothing outside the stack.
 *   9. TEETH — five broken twins with exact catch counts. Two of them partition the cursor space
 *      on the carry, so between them they prove the gate agrees with the RIGHT theory about
 *      which cursors carry, not merely that it disagrees with a wrong twin.
 *
 * HOLE: the corpus is one tape of 1800 frames. It reaches live play, but not every screen the
 * game can draw, and the sweep is what covers the rest of the input space.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0028.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { retreatCharCursor } from "../retreatCharCursor.js";
import { loc_0028 as oracle } from "../../translated/loc_0028.js";
import { buildRoutines } from "../../routines.js";
import { deadStackBelow, firstStateDiff, unitEquivalence } from "../../../../core/equivalence.js";
import { recordFrameFloors } from "./_frameFloor.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import {
  VIDEO_RAM_BASE,
  VIDEO_RAM_SIZE,
  WORK_RAM_BASE,
  WORK_RAM_SIZE,
} from "../../../../boards/timeplt/memory.js";
import { SCREEN_H, SCREEN_W, TILE_H } from "../../../../boards/timeplt/video.js";

const TARGET = 0x0028;
const STEP = 32;
const LIVE_OUT = ["d", "e"];
const EXCLUDED = ["a", "f", "sp"];
const CURSOR_SPACE = 65536;

// A low byte at or above this carries into the high byte; below it, the high byte is untouched.
// The two carry twins below are caught on exactly these two sets, which is how the split is
// checked against the routine rather than against itself.
const CARRY_FROM = 256 - STEP;
const CARRYING = STEP * 256;

// ENTRY_FRAMES is enough to ENTER, which is all the unit arm needs. The corpus and the two
// driven-run arms want a longer run, declared here rather than raised in the shared harness.
const CORPUS_FRAMES = 1800;
const VIDEO_RAM_TOP = VIDEO_RAM_BASE + VIDEO_RAM_SIZE - 1;
const WORK_RAM_TOP = WORK_RAM_BASE + WORK_RAM_SIZE - 1;

const OPTS = romsPresent() ? {} : { skip: "ROM images are gitignored; assemble them to run" };

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");

/**
 * The routine wrapped in the translated engine's calling convention, for the two driven-run arms
 * only. Nothing in the shipped layer looks like this: the wrapper exists so an experiment can run
 * INSIDE an engine whose callers still push a return address, and the difference between running
 * with it and without it is precisely what those two arms measure.
 */
const substitutable = (fn) => (m) => {
  fn(m);
  return m.ret();
};

let entry = null;

/** unitEquivalence with the pristine entry harvested off the candidate arm's own clone. */
function rawGate(candidate) {
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
  if (entry === null) rawGate(retreatCharCursor);
  return entry;
}

/** Oracle vs candidate from the real entry, with the cursor forced to `cursor`. */
function liveOutDiff(candidate, cursor) {
  const a = entryState().clone();
  const b = entryState().clone();
  a.regs.de = cursor;
  b.regs.de = cursor;
  oracle(a);
  candidate(b);
  for (const k of LIVE_OUT) {
    if (a.regs[k] !== b.regs[k]) return { reg: k, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** The whole comparison the real arm passes: the RAM half AND the live-out half. */
function gate(candidate) {
  const r = rawGate(candidate);
  return { ram: r.ram, live: liveOutDiff(candidate, entryState().regs.de) };
}

const show = (d) =>
  d ? `${d.reg ?? hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical";

/**
 * Replay a list of cursor values through both sides on two long-lived machines. Cloning per value
 * costs a tenth of a millisecond, which 65536 values cannot afford; reusing two machines is only
 * sound if neither side writes memory, so the caller is handed the RAM diff to check. The stack
 * pointer is re-seated every iteration because the ORACLE pops one on the way out and would
 * otherwise walk it clean off the stack over the course of a sweep.
 */
function replay(candidate, cursors) {
  const a = entryState().clone();
  const b = entryState().clone();
  const sp = entryState().regs.sp;
  const pristine = entryState().dumpState();
  let caught = 0;
  let first = null;
  for (const cursor of cursors) {
    a.regs.sp = sp;
    a.regs.de = cursor;
    b.regs.sp = sp;
    b.regs.de = cursor;
    oracle(a);
    candidate(b);
    if (a.regs.d !== b.regs.d || a.regs.e !== b.regs.e) {
      caught++;
      if (first === null) first = { cursor, oracleCursor: a.regs.de, candidateCursor: b.regs.de };
    }
  }
  const addrOf = (o) => a.stateOffsetToAddr(o);
  return {
    caught,
    first,
    wroteA: firstStateDiff(pristine, a.dumpState(), addrOf),
    wroteB: firstStateDiff(pristine, b.dumpState(), addrOf),
  };
}

const everyCursor = () => ({
  *[Symbol.iterator]() {
    for (let i = 0; i < CURSOR_SPACE; i++) yield i;
  },
});

/** Every cursor value the running game presents to this routine over the driven tape. */
let corpusCache = null;
function corpus() {
  if (corpusCache === null) {
    const cursors = [];
    const m = makeMachine(
      new Map([[TARGET, (mm) => {
        cursors.push(mm.regs.de);
        return oracle(mm);
      }]]),
    );
    m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the corpus run stopped early: ${m.stoppedBy}`);
    corpusCache = cursors;
  }
  return corpusCache;
}

/**
 * The deepest into work RAM the stack pointer is MEASURED to reach, sampled at every dispatch of
 * every routine over the driven run. Sampling at this routine's own dispatches is not enough —
 * the stack goes deeper under other calls, and a window drawn at the shallower mark would class
 * live stack scratch as an escape. Boot runs before the stack is seated, so samples outside work
 * RAM are dropped.
 */
let floorCache = null;
function stackFloor() {
  if (floorCache === null) {
    let low = WORK_RAM_TOP;
    const sampled = new Map();
    for (const [addr, fn] of buildRoutines()) {
      sampled.set(addr, (m, ...args) => {
        const sp = m.regs.sp;
        if (sp >= WORK_RAM_BASE && sp <= WORK_RAM_TOP && sp < low) low = sp;
        return fn(m, ...args);
      });
    }
    const m = makeMachine(sampled);
    m.runFrames(CORPUS_FRAMES);
    assert.equal(m.stoppedBy, null, `the stack-floor run stopped early: ${m.stoppedBy}`);
    assert.ok(low < WORK_RAM_TOP, "vacuous: no dispatch was sampled with a seated stack pointer");
    floorCache = low;
  }
  return floorCache;
}

/**
 * Wire a candidate into a driven run and diff every frame against the all-oracle baseline.
 * Divergence between the measured stack floor and the SP of that frame's sample is the dead scratch the
 * contract excludes; anything else has ESCAPED. A run that stops early reports how far it got.
 */
function drivenRun(candidate) {
  const floor = stackFloor();
  const base = makeMachine(new Map([[TARGET, oracle]]));
  const floors = recordFrameFloors(base);
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  assert.equal(base.stoppedBy, null, `the baseline itself stopped early: ${base.stoppedBy}`);

  let calls = 0;
  const opt = makeMachine(new Map([[TARGET, (m) => {
    calls++;
    return candidate(m);
  }]]));
  const optFrames = opt.runFrames(CORPUS_FRAMES);

  const escaped = new Set();
  const scratch = new Set();
  const compared = Math.min(baseFrames.length, optFrames.length);
  for (let f = 0; f < compared; f++) {
    const a = baseFrames[f];
    const b = optFrames[f];
    const dead = deadStackBelow({ lo: floor, hi: WORK_RAM_TOP + 1 }, floors[f]); // live from the sample's SP up
    for (let i = 0; i < a.length; i++) {
      if (a[i] === b[i]) continue;
      const addr = base.stateOffsetToAddr(i);
      if (dead(addr)) scratch.add(addr);
      else escaped.add(addr);
    }
  }
  return {
    escaped: [...escaped].sort((x, y) => x - y),
    scratch: [...scratch].sort((x, y) => x - y),
    stopped: opt.stoppedBy ? String(opt.stoppedBy) : null,
    reached: optFrames.length,
    compared,
    calls,
    floor,
  };
}

/**
 * Where a character painted at `cursor` lands on the raster, as a bounding box of changed pixels.
 * Both candidate cells are blanked in the baseline so the box is the painted character and not
 * whatever the game had drawn there; everything else, sprites included, is identical between the
 * two renders and cancels.
 */
const MARKER = 0x41;
function paintedBox(cursor, blank) {
  const m = entryState().clone();
  for (const cell of blank) m.mem8[cell] = 0;
  const before = m.renderFrame();
  m.mem8[cursor] = MARKER;
  const after = m.renderFrame();

  let minX = SCREEN_W, maxX = -1, minY = SCREEN_H, maxY = -1, pixels = 0;
  for (let y = 0; y < SCREEN_H; y++) {
    for (let x = 0; x < SCREEN_W; x++) {
      const o = (y * SCREEN_W + x) * 3;
      if (before[o] === after[o] && before[o + 1] === after[o + 1] && before[o + 2] === after[o + 2]) {
        continue;
      }
      pixels++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  return { pixels, minX, maxX, minY, maxY };
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("BLIND: the RAM half of the comparison cannot fail — a no-op passes it", OPTS, () => {
  const r = rawGate(() => {});
  assert.equal(
    r.ram,
    null,
    "the RAM diff CAUGHT a no-op, so this routine writes memory after all and every " +
      "live-out claim in this file must be re-derived from scratch",
  );
  console.log("  BLIND: RAM is vacuous here — the live-out half below is the whole gate");
});

test("EQUAL at the real dispatch: retreatCharCursor == oracle on RAM and the live-out", OPTS, () => {
  const r = gate(retreatCharCursor);
  assert.equal(r.ram, null, `RAM diverged — ${show(r.ram)}`);
  assert.equal(r.live, null, `the live-out diverged — ${show(r.live)}`);
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  console.log(`  EQUAL: entry cursor ${hex4(entryState().regs.de)}; RAM and cursor identical`);
});

test("EXCLUDED, deliberately: the accumulator, the flags and the stack pointer", OPTS, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  retreatCharCursor(b);

  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register outside the declared excluded set moved");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  assert.equal(a.regs.sp - b.regs.sp, 2, "the oracle pops a return address and the rewrite does not");
  assert.equal(a.regs.de, b.regs.de, "the one live-out");
  console.log(`  EXCLUDED: ${moved.join(", ")} and pc — the cursor matches`);
});

test("DIRECTION: one step moves a painted character exactly one cell along the grid", OPTS, () => {
  const before = entryState().regs.de;
  const stepped = entryState().clone();
  retreatCharCursor(stepped);
  const after = stepped.regs.de;

  const blank = [before, after];
  const at = paintedBox(before, blank);
  const on = paintedBox(after, blank);
  assert.ok(at.pixels > 0, "vacuous: the character painted at the captured cursor is not visible");
  assert.ok(on.pixels > 0, "vacuous: the character painted at the stepped cursor is not visible");
  assert.equal(on.minX, at.minX, "the step moved the character across the grid, not along it");
  assert.equal(on.maxX, at.maxX, "the step moved the character across the grid, not along it");
  assert.equal(
    on.minY - at.minY,
    TILE_H,
    "the step is not one whole cell — a fraction of one would smear a line of text",
  );
  console.log(
    `  DIRECTION: ${hex4(before)} paints at y ${at.minY}-${at.maxY}, ${hex4(after)} at ` +
      `y ${on.minY}-${on.maxY}, both at x ${at.minX}-${at.maxX} — one cell on, none across`,
  );
});

test("EXHAUSTIVE: all 65536 cursor values step as the oracle steps them", OPTS, () => {
  const r = replay(retreatCharCursor, everyCursor());
  assert.equal(r.caught, 0, `diverged on ${r.caught} cursor(s), first ${JSON.stringify(r.first)}`);
  assert.equal(r.wroteA, null, `the oracle wrote memory during the sweep — ${show(r.wroteA)}`);
  assert.equal(r.wroteB, null, `the rewrite wrote memory during the sweep — ${show(r.wroteB)}`);

  const wrapped = entryState().clone();
  wrapped.regs.de = 0xffff;
  retreatCharCursor(wrapped);
  assert.equal(wrapped.regs.de, 0x001f, "the step must wrap to sixteen bits, not widen past them");
  console.log(`  EXHAUSTIVE: ${CURSOR_SPACE} cursors identical, no memory written by either side`);
});

test("CORPUS: every cursor the running game presents is a video cell, stepped identically", OPTS, () => {
  const cursors = corpus();
  assert.ok(cursors.length > 0, "vacuous: the tape never dispatched the routine");
  const offMap = cursors.filter((c) => c < VIDEO_RAM_BASE || c > VIDEO_RAM_TOP);
  assert.deepEqual(
    offMap.map(hex4),
    [],
    "a real dispatch held something that is not a video-RAM address, so calling this pair a " +
      "character-cell cursor is wrong",
  );
  const carrying = cursors.filter((c) => (c & 0xff) >= CARRY_FROM).length;
  assert.ok(carrying > 0, "vacuous: the corpus never exercises the carry into the high byte");
  const r = replay(retreatCharCursor, cursors);
  assert.equal(r.caught, 0, `diverged on ${r.caught} real cursor(s), first ${JSON.stringify(r.first)}`);
  console.log(
    `  CORPUS: ${cursors.length} real dispatches over ${CORPUS_FRAMES} frames, ` +
      `${new Set(cursors).size} distinct cursors, ${carrying} of them carrying; all in video RAM`,
  );
});

// ── the stack, and what dropping it does and does not cost ──────────────────────────────

test("EXPECTED DIVERGENCE: substituted as-is, the engine leaks stack and gives up", OPTS, () => {
  const r = drivenRun(retreatCharCursor);
  assert.notEqual(
    r.stopped,
    null,
    "the driven run COMPLETED with the bare rewrite wired in. That is good news, not a " +
      "failure: the callers no longer push a return address, so the leak recorded here is " +
      "gone and this arm has outlived its purpose. Delete it.",
  );
  assert.match(
    r.stopped,
    /no routine registered/,
    "the run still stops early but for a different reason than the stale return address " +
      "this arm exists to record — re-derive before trusting the note",
  );
  assert.ok(r.calls > 0, "vacuous: the rewrite was never dispatched");
  assert.ok(r.reached < CORPUS_FRAMES, "a run that stopped early cannot have reached every frame");
  console.log(
    `  EXPECTED DIVERGENCE: reached frame ${r.reached} of ${CORPUS_FRAMES} after ${r.calls} ` +
      `dispatches, leaking two bytes each — ${r.stopped}`,
  );
});

test("LIVE-OUT (MEASURED): supply the return and nothing outside the stack diverges", OPTS, () => {
  const r = drivenRun(substitutable(retreatCharCursor));
  assert.equal(r.stopped, null, `the driven run stopped early with the return supplied: ${r.stopped}`);
  assert.equal(r.compared, CORPUS_FRAMES, "the run did not reach the frames it was asked for");
  assert.ok(r.calls > 0, "vacuous: the rewrite was never dispatched");
  assert.deepEqual(
    r.escaped.map(hex4),
    [],
    "a divergence reached memory outside the dead stack scratch — the dropped accumulator or flags " +
      "are live somewhere after all, and EXCLUDED is wrong",
  );
  assert.ok(
    r.scratch.length > 0,
    "nothing diverged at all, so this arm proves nothing about confinement — the dropped " +
      "registers are never even pushed and the measurement has no subject",
  );
  console.log(
    `  LIVE-OUT (MEASURED): ${r.calls} dispatches over ${r.compared} frames; divergence confined ` +
      `to ${r.scratch.length} cell(s) in the stack window above ${hex4(r.floor)}`,
  );
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────
// Five plausible ways to get this routine wrong. Three are caught on every cursor; the last two
// are the carry, and they are caught on complementary halves of the cursor space — the sum of
// their catch counts is the whole space, so between them they pin WHERE the carry happens and
// not merely that a twin is wrong somewhere.

/** BUG: does nothing — the tell that a gate is measuring an unreached or vacuous routine. */
function brokenNoOp() {}

/** BUG: steps thirty-one on, so the cursor drifts one cell per character drawn. */
function brokenOffByOne(m) {
  m.regs.de = (m.regs.de + STEP - 1) & 0xffff;
}

/** BUG: steps the other way, so a line of characters comes out reversed. */
function brokenWrongWay(m) {
  m.regs.de = (m.regs.de - STEP) & 0xffff;
}

/** BUG: steps the low byte only, so the cursor never crosses out of a page. */
function brokenNoCarry(m) {
  m.regs.e = (m.regs.e + STEP) & 0xff;
}

/** BUG: carries on every step, so the cursor gains a page it has not earned. */
function brokenAlwaysCarry(m) {
  m.regs.e = (m.regs.e + STEP) & 0xff;
  m.regs.d = (m.regs.d + 1) & 0xff;
}

const ALWAYS_CAUGHT = [
  ["no-op", brokenNoOp],
  ["off-by-one", brokenOffByOne],
  ["wrong-way", brokenWrongWay],
];

for (const [label, twin] of ALWAYS_CAUGHT) {
  test(`TEETH: the ${label} twin is CAUGHT at the real dispatch`, OPTS, () => {
    const r = gate(twin);
    assert.notEqual(r.live, null, `the gate PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught at the entry — ${show(r.live)}`);
  });

  test(`TEETH: the ${label} twin is CAUGHT on every cursor`, OPTS, () => {
    const r = replay(twin, everyCursor());
    assert.equal(r.caught, CURSOR_SPACE, `the sweep missed the ${label} twin somewhere`);
    console.log(`  TEETH/${label}: caught on all ${r.caught} cursors`);
  });
}

test("TEETH: the no-carry twin is INVISIBLE at the captured entry and caught by the sweep", OPTS, () => {
  assert.ok(
    (entryState().regs.de & 0xff) < CARRY_FROM,
    "the captured entry now carries, so this arm no longer demonstrates the hole it exists for",
  );
  const atEntry = gate(brokenNoCarry);
  assert.equal(atEntry.ram, null, "RAM is vacuous, as the BLIND arm establishes");
  assert.equal(
    atEntry.live,
    null,
    "the captured entry caught the no-carry twin — the hole this arm documents has closed",
  );

  const r = replay(brokenNoCarry, everyCursor());
  assert.equal(r.caught, CARRYING, "the sweep did not catch the twin on exactly the carrying cursors");
  console.log(`  TEETH/no-carry: invisible at the entry, caught on ${r.caught} carrying cursors`);
});

test("TEETH: the always-carry twin is caught on exactly the cursors the no-carry twin is not", OPTS, () => {
  const atEntry = gate(brokenAlwaysCarry);
  assert.notEqual(atEntry.live, null, "the gate PASSED the always-carry twin at the entry");

  const r = replay(brokenAlwaysCarry, everyCursor());
  assert.equal(
    r.caught,
    CURSOR_SPACE - CARRYING,
    "the two carry twins do not partition the cursor space, so the gate and the routine " +
      "disagree about which cursors carry",
  );
  console.log(`  TEETH/always-carry: caught on ${r.caught} non-carrying cursors — ${show(atEntry.live)}`);
});

test("TEETH: both carry twins are CAUGHT by the corpus and by the measured driven run", OPTS, () => {
  const cursors = corpus();
  const carrying = cursors.filter((c) => (c & 0xff) >= CARRY_FROM).length;
  assert.equal(
    replay(brokenNoCarry, cursors).caught,
    carrying,
    "the corpus did not catch the no-carry twin on exactly its carrying dispatches",
  );
  assert.equal(
    replay(brokenAlwaysCarry, cursors).caught,
    cursors.length - carrying,
    "the corpus did not catch the always-carry twin on exactly its non-carrying dispatches",
  );

  // Without a tooth of its own, "divergence confined to the stack window" could mean the
  // driven-run comparison simply cannot see anything. It can.
  const w = drivenRun(substitutable(brokenNoCarry));
  assert.ok(
    w.stopped !== null || w.escaped.length > 0,
    "the measured driven run PASSED the no-carry twin, so its confinement result is vacuous",
  );
  console.log(
    `  TEETH/carry: caught on ${carrying} and ${cursors.length - carrying} real dispatches; ` +
      `measured driven run ${w.stopped ? "stopped early" : `escaped to ${w.escaped.slice(0, 4).map(hex4).join(" ")}`}`,
  );
});
