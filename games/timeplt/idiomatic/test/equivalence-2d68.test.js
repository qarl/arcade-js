// SPDX-License-Identifier: GPL-3.0-only
/**
 * driftOneTileSceneryAtHalf — memory-equivalent to the frozen oracle at ROM 0x2D68.
 *
 * WHAT IT IS. Six bytes: call the half-speed drift, then tail-jump to the slot step. BOTH are
 * ALREADY decompiled, so the rewrite calls driftAtHalfWorldScroll and advanceToNextSlot directly
 * and dissolving the two transfers belongs to this caller's unit. The whole content of the entry
 * is WHICH fraction of the shared displacement is applied and that exactly one slot is stepped.
 *
 * GATE: strict unit-capture over every dispatch of two replayed real sessions, a crafted sweep of
 *   the shared displacement, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM identical outside the dead stack bytes, and BOTH cursors
 *      the entry leaves behind identical too; they are live-outs and are compared explicitly.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, three bytes below the stack pointer: the oracle pushes a
 *      return address for the inner call and pops it, and the rewrite models no stack. The corpus
 *      arm asserts the exact set of offsets ever dirtied, so the window cannot quietly widen.
 *   3. EXCLUDED, DELIBERATELY — the register file may differ only within {f, b, c, sp}, and pc.
 *      The arm BOUNDS the divergence rather than pinning it: a register outside that set fails,
 *      a register that stops diverging does not, since a rewrite that drops one is better. The
 *      two cursors are outside the set and are compared explicitly by arm 1 besides. The pair
 *      the inner drift leaves is dead; the whole-machine arm is what holds that.
 *   4. CORPUS — every dispatch of two sessions replayed, with both dispatch counts asserted.
 *   5. CRAFTED — the shared displacement swept over values that force a carry out of each
 *      coordinate's fraction and both signs, which real play does not present in one session.
 *   6. WHOLE-MACHINE — both sessions with the rewrite wired through the omitted-return seam.
 *   7. TEETH — six twins, each with exact catch counts.
 *
 * HOLE: a real session presents whatever displacements the camera happens to produce, which is a
 * narrow band around zero; the crafted arm is the only one that reaches a large displacement or a
 * fraction that carries on both axes at once.
 * HOLE: the crafted arm varies the DISPLACEMENT and holds the two slot bases at the real ones, so
 * nothing here speaks for a slot at the end of its block.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-2d68.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { driftOneTileSceneryAtHalf } from "../driftOneTileSceneryAtHalf.js";
import { driftAtHalfWorldScroll } from "../driftAtHalfWorldScroll.js";
import { driftAtThreeQuartersWorldScroll } from "../driftAtThreeQuartersWorldScroll.js";
import { driftWithWorldScroll } from "../driftWithWorldScroll.js";
import { advanceToNextSlot } from "../advanceToNextSlot.js";
import { loc_2d68 as oracle } from "../../translated/loc_2d68.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { WORLD_SCROLL_X, WORLD_SCROLL_Y } from "../names.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x2d68;

const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;

const SCRATCH_BYTES = 4;
const SCRATCH_OFFSETS = [-4, -3, -2];
const EXCLUDED = ["f", "b", "c", "sp"];

const CORPUS_FRAMES = 2000;
const DISPATCHES = { shared: 1386, attract: 1102 };
const TAPES = [
  ["shared", {}],
  ["attract", { tape: [] }],
];

/**
 * The dead bytes a WHOLE session leaves differing: the omitted returns at the call depths this
 * entry is reached at, plus the two at the top of the stack where the frame interrupt pushes the
 * program counter it pops again. Measured.
 */
const SESSION_SCRATCH = [0xafdc, 0xafdd, 0xafde, 0xafdf, 0xafe0, 0xaffd, 0xaffe];

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

/** Oracle vs candidate on clones: masked RAM first, then the two cursors. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const stray = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (stray) return stray;
  if (a.regs.ix !== b.regs.ix) return { addr: null, a: a.regs.ix, b: b.regs.ix };
  if (a.regs.iy !== b.regs.iy) return { addr: null, a: a.regs.iy, b: b.regs.iy };
  return null;
}

function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  const dirty = new Set();
  const displacements = new Set();
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    displacements.add(mm.mem16[WORLD_SCROLL_Y]);
    const sp = mm.regs.sp;
    const a = mm.clone();
    const b = mm.clone();
    oracle(a);
    candidate(b);
    for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) dirty.add(d.addr - sp);
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]), opts);
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, dirty, displacements };
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, driftOneTileSceneryAtHalf) }));
  return cache;
}

let entry = null;
function entryState() {
  if (entry === null) {
    const m = makeMachine(new Map([[TARGET, (mm) => {
      if (entry === null) entry = mm.clone();
      return oracle(mm);
    }]]));
    m.runFrames(CORPUS_FRAMES);
  }
  assert.notEqual(entry, null, "vacuous: the tape never reached the routine");
  return entry;
}

/** A real captured machine with the shared displacement pair forced. */
function craft(first, second) {
  const m = entryState().clone();
  m.mem16[WORLD_SCROLL_Y] = first;
  m.mem16[WORLD_SCROLL_X] = second;
  return m;
}

/** Values chosen to straddle the carry out of a fraction and both signs of the halving. */
const DISPLACEMENTS = [0, 1, 2, 3, 0x00ff, 0x0100, 0x0101, 0x7fff, 0x8000, 0x8001, 0xfffe, 0xffff];
const SWEEP_SIZE = DISPLACEMENTS.length * DISPLACEMENTS.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (const first of DISPLACEMENTS) {
    for (const second of DISPLACEMENTS) if (unitDiff(candidate, craft(first, second))) caught++;
  }
  return caught;
}

function wholeRunCells(candidate, opts) {
  const base = makeMachine(undefined, opts);
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(
    new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]),
    opts,
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

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: drifts the object and leaves the cursors where they were. */
function brokenNoAdvance(m) {
  driftAtHalfWorldScroll(m);
}

/** BUG: steps the cursors without drifting anything. */
function brokenNoDrift(m) {
  advanceToNextSlot(m);
}

/** BUG: the next rung of the parallax ladder, which is the nearest wrong fraction. */
function brokenThreeQuarters(m) {
  driftAtThreeQuartersWorldScroll(m);
  advanceToNextSlot(m);
}

/** BUG: the whole displacement instead of half of it. */
function brokenWholeDisplacement(m) {
  driftWithWorldScroll(m);
  advanceToNextSlot(m);
}

/** BUG: two slots are stepped instead of one, so the caller's walk skips an object. */
function brokenStepsTwice(m) {
  driftAtHalfWorldScroll(m);
  m.regs.ix = m.regs.ix + 2 * RECORD_STRIDE;
  m.regs.iy = m.regs.iy + 2 * ENTRY_STRIDE;
}

const TWINS = [
  ["no-op", brokenNoOp, 144, [1386, 1102]],
  ["no-advance", brokenNoAdvance, 144, [1386, 1102]],
  ["no-drift", brokenNoDrift, 140, [1383, 1101]],
  ["three-quarters", brokenThreeQuarters, 128, [1383, 1101]],
  ["whole-displacement", brokenWholeDisplacement, 140, [1383, 1101]],
  ["steps-twice", brokenStepsTwice, 144, [1386, 1102]],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: driftOneTileSceneryAtHalf == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  driftOneTileSceneryAtHalf(b);
  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.ix, b.regs.ix, "the record cursor left behind");
  assert.equal(a.regs.iy, b.regs.iy, "the entry cursor left behind");
  console.log(`  EQUAL: record=${hex4(entryState().regs.ix)} entry=${hex4(entryState().regs.iy)}`);
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers, pc and the scratch push, and nothing else", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  driftOneTileSceneryAtHalf(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    assert.deepEqual(
      [...s.dirty].sort((x, y) => x - y),
      SCRATCH_OFFSETS,
      `the ${s.label} session dirtied a different window under the stack pointer`,
    );
    total += s.dispatches;
  }
  console.log(
    `  CORPUS: ${total} real dispatches, displacements seen ` +
      sessions().map((s) => `${s.label} ${s.displacements.size}`).join(", "),
  );
});

test("CRAFTED: the displacement pair swept over carries and both signs", { skip }, () => {
  assert.equal(sweepCaught(driftOneTileSceneryAtHalf), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  CRAFTED: ${SWEEP_SIZE} displacement pairs identical`);
});

for (const [label, opts] of TAPES) {
  test(`WHOLE-MACHINE: the ${label} session differs only in the dead stack bytes`, { skip }, () => {
    const r = wholeRunCells(driftOneTileSceneryAtHalf, opts);
    assert.equal(r.threw, null, `the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `the run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, "vacuous: the override never dispatched");
    assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the dead stack bytes");
    console.log(
      `  WHOLE-MACHINE/${label}: ${r.fired} dispatches, only ${r.cells.map(hex4).join(" ")} differ`,
    );
  });
}

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, craftedCaught, perSession] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    assert.equal(sweepCaught(twin), craftedCaught, `the ${label} twin's crafted catch count moved`);
    console.log(`  TEETH/${label}: caught on ${craftedCaught} of ${SWEEP_SIZE} crafted entries`);
  });

  test(`TEETH: the ${label} twin is caught on an exact count of real dispatches`, { skip }, () => {
    const counts = TAPES.map(([, opts]) => replaySession(opts, twin));
    for (const [i, r] of counts.entries()) {
      assert.equal(r.dispatches, DISPATCHES[TAPES[i][0]], "the session's dispatch count moved");
      assert.equal(r.caught, perSession[i], `the ${label} twin's ${TAPES[i][0]} catch count moved`);
    }
    console.log(`  TEETH/${label}: real sessions catch ${counts.map((r) => r.caught).join("/")}`);
  });
}
