// SPDX-License-Identifier: GPL-3.0-only
/**
 * markObjectsTouchingPlayer — memory-equivalent to the frozen oracle at ROM 0x51B3.
 *
 * GATE: a large real corpus from two tapes, plus crafted entries that force the arms real play
 *   does not present. What it exercises, holes stated:
 *
 *   1. CORPUS — a bounded sample of every dispatch of both tapes, each a whole-state-dump
 *      comparison; the total dispatch count is asserted, so a shrinking corpus fails loudly.
 *   2. NO EXCLUSION WINDOW AT ALL — this routine pushes nothing, so the two arms agree on every
 *      byte of the dump including the stack. Asserted rather than assumed.
 *   3. NO REGISTER IS LIVE AT EXIT, measured on the ORACLE (DEAD AT EXIT): wrapped in the
 *      all-frozen game, every register it leaves — the cursors and the count included — is
 *      complemented on the way out and is unheard anywhere over five sessions (the driven one,
 *      and the era-1, era-2, era-4 and armed-ship holds that route the collision pass through
 *      each of its callers), while a complemented stack pointer is heard in game data in each
 *      (assertDeadAtExit). So registers
 *      and pc are not compared; the oracle's own walk (WALK) still pins the loop's shape.
 *   4. WHAT THE CORPUS COVERS, AND WHAT IT DOES NOT — measured: how many real dispatches pass the
 *      guard, how many find an object in play, and how many actually mark one. If real play never
 *      marks anything, the crafted arms are the only thing gating the mark, and this says so.
 *   5. THE MARK LANDS — crafted so an object sits exactly on the reference: one state byte moves,
 *      to the value this file names, and no other cell does. Measured off the ORACLE.
 *   6. THE BOX IS TWO-SIDED AND WRAPPED — the object walked along one axis through the whole 256
 *      values, twice (once per axis), with the set of positions that mark recorded as a run. That
 *      is what shows the test is a wrapped window and not a comparison.
 *   7. BOTH AXES ARE REQUIRED — an object inside the box on one axis and outside on the other is
 *      not marked, asserted for each axis separately.
 *   8. THE COUNT OF ZERO WALKS 256 SLOTS — asserted against a count of one, so the loop's shape
 *      is pinned at the value a naive rewrite gets wrong; in the cross, a count of zero over a
 *      planted object is what shows it in memory.
 *   9. TEETH — twins, each reported with its catch count over the crafted cross.
 *
 * HOLE: what a marked object goes on to do is not covered here, nor what the guard byte or the
 * reference position belong to. The crafted arms use a run of one slot except where stated, so
 * the multi-slot walk is covered by the real corpus and by arm 8 rather than exhaustively.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-51b3.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { markObjectsTouchingPlayer } from "../markObjectsTouchingPlayer.js";
import { loc_51b3 as oracle } from "../../translated/loc_51b3.js";
import { u8, u16 } from "../../../../core/int.js";
import { ERA_INDEX, PLAYER_STATE } from "../names.js";
import { assertDeadAtExit } from "./_deadAtExit.js";

const TARGET = 0x51b3;

const REFERENCE_FIRST_AXIS = 0xaa10;
const REFERENCE_SECOND_AXIS = 0xaa41;
const SECOND_AXIS_OFFSET = 49;
const ENTRY_STRIDE = 2;
const STATE_STRIDE = 16;
const IN_PLAY = 0xff;
const MARKED = 0xf0;

const DISPATCHES = { shared: 152, attract: 140 };
const TAPES = [["shared", {}], ["attract", { tape: [] }]];
/** How many entry states are kept per tape. The COUNT above is of every dispatch, not of these. */
const KEEP_PER_TAPE = 40;

/** The sessions DEAD AT EXIT poisons over (JS frames): driven, and the holds that route each caller. */
const DEAD_FRAMES = 2400;
const DEAD_SESSIONS = {
  driven: [],
  "era 1": [{ addr: ERA_INDEX, val: 1, frame: 701, dur: null }],
  "era 2": [{ addr: ERA_INDEX, val: 2, frame: 901, dur: null }],
  "era 4": [{ addr: ERA_INDEX, val: 4, frame: 701, dur: null }],
  armed: [{ addr: 0xad02, val: 0, frame: 621, dur: null }],
};
/** Every register the oracle can leave behind, the stack pointer apart. */
const LEFT_BEHIND = ["a", "f", "b", "c", "d", "e", "h", "l", "ix", "iy", "a_", "f_", "b_", "c_", "d_", "e_", "h_", "l_"];

/** Where the crafted arms put the state bytes and the objects, clear of anything the game uses. */
const CRAFTED_STATES = 0xaf00;
const CRAFTED_ENTRY = 0xaf40;
const CRAFTED_OFFSET = 8;
const CRAFTED_WIDTH = 17;

const skip = romsPresent() ? false : "ROM images are gitignored; nothing to gate";
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

let corpusCache = null;
function corpus() {
  if (corpusCache) return corpusCache;
  corpusCache = TAPES.map(([label, opts]) => {
    const states = [];
    let dispatches = 0;
    let guarded = 0;
    let anyInPlay = 0;
    let marked = 0;
    const host = makeMachine(
      new Map([[TARGET, (mm) => {
        dispatches++;
        if (states.length < KEEP_PER_TAPE) states.push(mm.clone());
        if (mm.mem8[PLAYER_STATE] === IN_PLAY) guarded++;
        let live = false;
        let index = mm.regs.e;
        let left = mm.regs.b;
        do {
          if (mm.mem8[(mm.regs.d << 8) + index] === IN_PLAY) live = true;
          index = u8(index + STATE_STRIDE);
          left = u8(left - 1);
        } while (left !== 0);
        if (live) anyInPlay++;
        const before = mm.dumpState();
        const probe = mm.clone();
        oracle(probe);
        const after = probe.dumpState();
        for (let i = 0; i < before.length; i++) {
          if (before[i] !== after[i]) { marked++; break; }
        }
        return oracle(mm);
      }]]),
      opts,
    );
    const frames = host.runFrames(ENTRY_FRAMES);
    assert.equal(host.stoppedBy, null, `the ${label} session stopped early: ${host.stoppedBy}`);
    assert.equal(frames.length, ENTRY_FRAMES, `the ${label} session ran short`);
    assert.equal(dispatches, DISPATCHES[label], `the ${label} dispatch count moved`);
    return { label, states, dispatches, guarded, anyInPlay, marked };
  });
  return corpusCache;
}

const anEntry = () => corpus()[0].states[0];

/**
 * A crafted entry: a run of `slots` objects at fixed cells clear of the game's own, with the
 * reference position and the box the caller supplies both forced, and one object placed at a
 * chosen offset from the reference on each axis.
 */
function craft({ guard = IN_PLAY, state = IN_PLAY, first = 0, second = 0, slots = 1,
  offset = CRAFTED_OFFSET, width = CRAFTED_WIDTH, reference = 0x80, count = slots, start = 0 } = {}) {
  const m = anEntry().clone();
  m.mem8[PLAYER_STATE] = guard;
  m.mem8[REFERENCE_FIRST_AXIS] = reference;
  m.mem8[REFERENCE_SECOND_AXIS] = reference;
  for (let i = 0; i < 256; i++) m.mem8[CRAFTED_STATES + i] = 0;
  for (let i = 0; i < 256; i++) m.mem8[CRAFTED_ENTRY + i] = 0;
  for (let i = 0; i < slots; i++) {
    m.mem8[CRAFTED_STATES + u8(start + i * STATE_STRIDE)] = state;
    m.mem8[CRAFTED_ENTRY + i * ENTRY_STRIDE] = u8(reference - first);
    m.mem8[CRAFTED_ENTRY + i * ENTRY_STRIDE + SECOND_AXIS_OFFSET] = u8(reference - second);
  }
  m.regs.de = CRAFTED_STATES + start;
  m.regs.iy = CRAFTED_ENTRY;
  m.regs.b = count;
  m.regs.l = offset;
  m.regs.h = width;
  return m;
}

/** Whether the ORACLE marks the first crafted slot, for one set of priors. */
function oracleMarks(opts) {
  const m = craft(opts);
  oracle(m);
  return m.mem8[CRAFTED_STATES] === MARKED;
}

const CROSS = [];
for (const guard of [IN_PLAY, 0x00, 0x7f]) {
  for (const state of [IN_PLAY, 0x00, MARKED]) {
    for (const first of [0, 4, -4, 40]) {
      for (const second of [0, 4, -4, 40]) CROSS.push({ guard, state, first, second });
    }
  }
}
CROSS.push({ slots: 3 }, { slots: 8 }, { slots: 0 }, { width: 1 }, { width: 255 }, { offset: 0 });
// a count of zero over a planted object: the whole-256 walk marks it, a walk of none does not
CROSS.push({ slots: 1, count: 0 });
// a run that starts on the page's last slot: the state cursor wraps to the page's first, not the next page
CROSS.push({ slots: 2, start: 0xf0 });

function crossCaught(candidate) {
  let caught = 0;
  for (const opts of CROSS) if (unitDiff(candidate, craft(opts))) caught++;
  return caught;
}

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CORPUS: a sample of every dispatch of two real sessions replays identically", { skip }, () => {
  let sampled = 0;
  for (const s of corpus()) {
    assert.ok(s.states.length > 0, `vacuous: the ${s.label} tape never reached the routine`);
    for (const state of s.states) {
      const d = unitDiff(markObjectsTouchingPlayer, state);
      assert.equal(d, null, `${s.label}: ${show(d)}`);
    }
    sampled += s.states.length;
  }
  const total = corpus().reduce((n, s) => n + s.dispatches, 0);
  console.log(`  CORPUS: ${sampled} entry states sampled from ${total} real dispatches, identical`);
});

test("NO EXCLUSION WINDOW: the two arms agree on the stack too", { skip }, () => {
  const entry = craft({});
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  markObjectsTouchingPlayer(b);
  assert.deepEqual(allDiffs(a, b), [],
    "a byte of the dump differs, so this routine pushes after all and the gate needs a window");
  console.log("  NO WINDOW: identical on every byte of the dump, the stack included");
});

test("NOT VACUOUS: a no-op candidate FAILS the same comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft({}));
  assert.notEqual(d, null, "the comparison passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a real cell, not on a register");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("WALK: the oracle's cursors walk the run, and pc is the oracle's own", { skip }, () => {
  const entry = craft({ slots: 3 });
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  markObjectsTouchingPlayer(b);
  assert.equal(a.regs.e, u8(CRAFTED_STATES + 3 * STATE_STRIDE), "the state cursor did not walk three slots");
  assert.equal(a.regs.iy, CRAFTED_ENTRY + 3 * ENTRY_STRIDE, "the entry cursor did not walk three slots");
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log("  WALK: three slots walked by both cursors on the oracle");
});

test("DEAD AT EXIT: no register the oracle leaves is heard, and a complemented stack pointer is", { skip }, () => {
  // Beside the helper's SP flip: SP complemented on the way out must reach game data in EVERY session.
  assertDeadAtExit({
    at: TARGET, poison: LEFT_BEHIND, frames: DEAD_FRAMES, reachEvery: true,
    sessions: Object.entries(DEAD_SESSIONS).map(([label, pokes]) => ({ label, pokes })),
    controls: [{ label: "SP complemented", poison: ["sp"], dataOnly: true, every: true }],
  });
});

test("WHAT THE CORPUS COVERS, AND WHAT IT DOES NOT", { skip }, () => {
  const totals = corpus().map((s) => `${s.label} ${s.guarded}/${s.anyInPlay}/${s.marked} of ${s.dispatches}`);
  const marked = corpus().reduce((n, s) => n + s.marked, 0);
  assert.ok(corpus().some((s) => s.guarded > 0), "no real dispatch passes the guard at all");
  console.log(
    `  COVERAGE (guard passed / an object in play / anything written): ${totals.join(", ")}` +
      (marked === 0 ? " — REAL PLAY NEVER WRITES HERE, so the crafted arms carry the mark" : ""),
  );
});

test("THE MARK LANDS: one state byte, to the value this file names, and nothing else", { skip }, () => {
  const before = craft({});
  const after = before.clone();
  oracle(after);
  const moved = allDiffs(before, after);
  assert.equal(moved.length, 1, `the oracle moved ${moved.length} cells, not one`);
  assert.equal(moved[0].addr, CRAFTED_STATES, "the cell moved is not the object's state byte");
  assert.equal(after.mem8[CRAFTED_STATES], MARKED, "the state byte did not take the marked value");
  console.log(`  LANDS: ${hex4(CRAFTED_STATES)} goes ${hex4(IN_PLAY)} -> ${hex4(MARKED)}`);
});

test("THE BOX IS TWO-SIDED AND WRAPPED: the marking positions form one run per axis", { skip }, () => {
  for (const axis of ["first", "second"]) {
    const marking = [];
    for (let delta = 0; delta < 256; delta++) {
      if (oracleMarks({ [axis]: delta })) marking.push(delta);
    }
    assert.equal(marking.length, CRAFTED_WIDTH,
      `${axis} axis: ${marking.length} positions mark, not the width the caller supplied`);
    const wrapped = marking.map((d) => u8(d + CRAFTED_OFFSET)).sort((x, y) => x - y);
    assert.deepEqual(wrapped, Array.from({ length: CRAFTED_WIDTH }, (_unused, i) => i),
      `${axis} axis: the marking positions are not one contiguous wrapped run`);
    assert.ok(marking.includes(0) && marking.includes(255),
      `${axis} axis: the run does not straddle the wrap, so nothing here shows it is wrapped`);
  }
  console.log(`  BOX: ${CRAFTED_WIDTH} marking positions per axis, straddling the wrap`);
});

test("BOTH AXES ARE REQUIRED: inside on one and outside on the other marks nothing", { skip }, () => {
  assert.ok(oracleMarks({ first: 0, second: 0 }), "the control case must mark");
  assert.ok(!oracleMarks({ first: 0, second: 40 }), "outside on the second axis still marked");
  assert.ok(!oracleMarks({ first: 40, second: 0 }), "outside on the first axis still marked");
  assert.ok(!oracleMarks({ first: 40, second: 40 }), "outside on both axes still marked");
  console.log("  BOTH AXES: only inside-on-both marks");
});

test("A COUNT OF ZERO WALKS 256 SLOTS, not none", { skip }, () => {
  const zero = craft({ slots: 0 });
  const one = craft({ slots: 1 });
  const a = zero.clone();
  const b = one.clone();
  oracle(a);
  oracle(b);
  assert.equal(a.regs.iy, CRAFTED_ENTRY + 256 * ENTRY_STRIDE,
    "a count of zero did not walk 256 slots, so the loop's shape is not what this file says");
  assert.equal(b.regs.iy, CRAFTED_ENTRY + ENTRY_STRIDE, "a count of one did not walk one slot");
  assert.equal(unitDiff(markObjectsTouchingPlayer, craft({ slots: 0 })), null, "the rewrite diverged on a zero count");
  console.log("  ZERO COUNT: 256 slots walked, against one for a count of one");
});

test("CROSS: the rewrite agrees with the oracle on every crafted entry the teeth use", { skip }, () => {
  assert.equal(crossCaught(markObjectsTouchingPlayer), 0, "the rewrite diverged on a crafted entry");
  console.log(`  CROSS: ${CROSS.length} crafted entries identical, the page-wrapping run included`);
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

function sweep(m, { checkGuard = true, axes = 2, mark = MARKED, requireInPlay = true,
  stateStride = STATE_STRIDE, entryStride = ENTRY_STRIDE, secondOffset = SECOND_AXIS_OFFSET,
  zeroIsNone = false, wrapsInPage = true } = {}) {
  const { mem8, regs } = m;
  if (checkGuard && mem8[PLAYER_STATE] !== IN_PLAY) return;
  const offset = regs.l;
  const width = regs.h;
  const near = (reference, coordinate) => u8(mem8[reference] - mem8[coordinate] + offset) < width;
  const page = regs.d << 8;
  let index = regs.e;
  let entry = regs.iy;
  let left = regs.b;
  if (zeroIsNone && left === 0) return;
  do {
    const live = !requireInPlay || mem8[page + index] === IN_PLAY;
    const inBox = near(REFERENCE_FIRST_AXIS, entry) &&
      (axes < 2 || near(REFERENCE_SECOND_AXIS, entry + secondOffset));
    if (live && inBox) mem8[page + index] = mark;
    index = wrapsInPage ? u8(index + stateStride) : index + stateStride;
    entry = u16(entry + entryStride);
    left = u8(left - 1);
  } while (left !== 0);
  regs.e = index;
  regs.iy = entry;
  regs.b = 0;
}

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: ignores the guard byte, so it marks whether or not the guard allows it. */
const brokenIgnoresGuard = (m) => sweep(m, { checkGuard: false });

/** BUG: tests one axis only, so a distant object on the other axis is marked. */
const brokenOneAxis = (m) => sweep(m, { axes: 1 });

/** BUG: marks with a different value. */
const brokenMarkValue = (m) => sweep(m, { mark: MARKED + 1 });

/** BUG: marks an object whatever its own state byte says. */
const brokenIgnoresState = (m) => sweep(m, { requireInPlay: false });

/** BUG: steps the state cursor by one instead of a slot. */
const brokenStateStride = (m) => sweep(m, { stateStride: 1 });

/** BUG: steps the entry cursor by one instead of an entry. */
const brokenEntryStride = (m) => sweep(m, { entryStride: 1 });

/** BUG: reads the second axis from the byte beside it. */
const brokenSecondOffset = (m) => sweep(m, { secondOffset: SECOND_AXIS_OFFSET + 1 });

/** BUG: carries the state cursor into the next page instead of wrapping inside its own. */
const brokenLeavesPage = (m) => sweep(m, { wrapsInPage: false });

/** BUG: treats a count of zero as no slots rather than as 256. */
const brokenZeroIsNone = (m) => sweep(m, { zeroIsNone: true });

const TWINS = [
  ["no-op", brokenNoOp],
  ["ignores-the-guard", brokenIgnoresGuard],
  ["one-axis-only", brokenOneAxis],
  ["wrong-mark-value", brokenMarkValue],
  ["ignores-the-state-byte", brokenIgnoresState],
  ["state-stride-of-one", brokenStateStride],
  ["entry-stride-of-one", brokenEntryStride],
  ["second-axis-off-by-one", brokenSecondOffset],
  ["zero-count-walks-nothing", brokenZeroIsNone],
  ["state-cursor-leaves-its-page", brokenLeavesPage],
];

for (const [label, twin] of TWINS) {
  test(`TEETH: the ${label} twin is CAUGHT in the crafted cross`, { skip }, () => {
    const caught = crossCaught(twin);
    assert.ok(caught > 0, `the cross PASSED the ${label} twin — it has no teeth`);
    console.log(`  TEETH/${label}: caught on ${caught} of ${CROSS.length} crafted entries`);
  });
}
