// SPDX-License-Identifier: GPL-3.0-only
/**
 * pulseSlot2CoinCounter — memory-equivalent to the frozen oracle at ROM 0x49D6.
 *
 * WHAT IT IS. A pulse train driven one step per call: a pending count, a phase counter, and one
 * hardware output line raised at the start of a phase and dropped at its midpoint.
 *
 * ★ RAM IS NOT THE WHOLE GATE HERE, AND THAT IS THE POINT. The line this entry drives is a latch
 *   bit, not a memory cell, so it does not appear in the state dump at all. A comparison that
 *   looked only at RAM would pass a candidate that never touches the line — measured, not argued:
 *   the LINE IS INVISIBLE arm below asserts exactly that a line-dropping twin survives the RAM
 *   diff and is caught only once the latch is compared. Every arm in this file therefore compares
 *   the latch as well as memory.
 *
 * ★ THE REAL CORPUS IS ENTIRELY THE IDLE ARM, AND EVERY ARM HERE SAYS SO. All 1765 dispatches of
 *   the shared session arrive with NOTHING PENDING, so the routine returns having done nothing —
 *   the CORPUS SHAPE arm asserts that count exactly. A real dispatch therefore cannot tell a
 *   correct rewrite from one that does nothing at all, and the REAL DISPATCH IS VACUOUS arm
 *   asserts that too rather than leaving it implied. The crafted sweep is the whole gate.
 *
 * GATE: an EXHAUSTIVE crafted sweep of everything this entry reads, a replayed real session that
 *   is measured and declared vacuous, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM and the whole latch identical, with nothing masked;
 *      neither side writes the stack. TRUE BUT VACUOUS, and arm 2 measures the vacuity.
 *   2. REAL DISPATCH IS VACUOUS, MEASURED — a no-op twin PASSES at the captured entry.
 *   3. NOT VACUOUS, CRAFTED — the same no-op twin FAILS on a crafted entry with work to do.
 *   4. EXCLUDED, DELIBERATELY — the union of every register that differs anywhere in the crafted
 *      sweep is asserted to stay INSIDE {a, f, l, sp} rather than to equal it, so a rewrite that
 *      leaves one MORE register alone than the original passes. Taking the union over the whole
 *      space rather than at one entry is what stops the arms an entry never reaches from hiding a
 *      register that does move.
 *   5. CORPUS — every dispatch replayed, with the count and the arm histogram asserted.
 *   6. EXHAUSTIVE — all 256 phase values, four pending counts, and BOTH starting states of the
 *      driven line, which is what makes a spurious drop visible: writing a zero over a zero
 *      changes nothing, so half of these twins are invisible unless the line starts high.
 *   7. WHOLE-MACHINE — the shared session with the rewrite wired through the omitted-return seam.
 *   8. TEETH — eight twins, each with exact catch counts. SEVEN of the eight are caught ZERO times
 *      by the real session, which is arm 2's finding stated per twin. The eighth removes the
 *      idle gate, and so is caught on every one of the 1765 real dispatches — that contrast is
 *      what shows the corpus is measuring the gate and only the gate.
 *
 * HOLE: the whole-machine arm compares memory, which cannot see the line either, and the session
 * it runs never leaves the idle arm. It is the crafted sweep alone that holds this entry to the
 * line it drives.
 * HOLE: nothing here says what the line is FOR. Its bit position is the only thing this file
 * knows about it, and a wrong belief about the device on the other end would not fail any arm.
 * HOLE: no tape reached a state with a pulse pending, so every non-idle arm of this routine is
 * exercised by crafted priors only.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-49d6.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { pulseSlot2CoinCounter } from "../pulseSlot2CoinCounter.js";
import { loc_49d6 as oracle } from "../../translated/loc_49d6.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x49d6;

const PENDING = 0xa982;
const PHASE = 0xa985;
const PHASE_LENGTH = 48;
const HALFWAY = 24;
const OUTPUT_LINE = 0xc30c;
const LATCH_BIT = (OUTPUT_LINE - 0xc300) >> 1;
const STORE_BUS_OFFSET = 10;

const EXCLUDED = ["a", "f", "l", "sp"];
const CORPUS_FRAMES = 2000;
const DISPATCHES = 1765;

/** The only cells a whole session leaves differing: where the frame interrupt pushes. Measured. */
const SESSION_SCRATCH = [0xaffd, 0xaffe];

const skip = romsPresent() ? false : "ROM images are not assembled";
const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${d.what}: oracle=${d.a} candidate=${d.b}` : "identical");

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ what: hex4(a.stateOffsetToAddr(i)), a: da[i], b: db[i] });
  }
  return out;
}

/** RAM alone, so the file can MEASURE that RAM is blind to the line rather than claim it. */
function ramDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b)[0] ?? null;
}

/** RAM and then the latch, which is where the line lives. */
function unitDiff(candidate, machine) {
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const stray = allDiffs(a, b)[0];
  if (stray) return stray;
  for (let bit = 0; bit < a.io.latch.length; bit++) {
    if (a.io.latch[bit] !== b.io.latch[bit]) {
      return { what: `latch bit ${bit}`, a: a.io.latch[bit], b: b.io.latch[bit] };
    }
  }
  return null;
}

function replaySession(candidate) {
  let dispatches = 0;
  let caught = 0;
  const arms = { idle: 0, armed: 0, dropped: 0, spent: 0, counting: 0 };
  const m = makeMachine(new Map([[TARGET, (mm) => {
    dispatches++;
    if (mm.mem8[PENDING] === 0) arms.idle++;
    else if (mm.mem8[PHASE] === 0) arms.armed++;
    else if (mm.mem8[PHASE] === 1) arms.spent++;
    else if (mm.mem8[PHASE] === HALFWAY + 1) arms.dropped++;
    else arms.counting++;
    if (unitDiff(candidate, mm)) caught++;
    return oracle(mm);
  }]]));
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, arms };
}

let cache = null;
const session = () => (cache ??= replaySession(pulseSlot2CoinCounter));

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

/** A real captured machine with the two cells this entry reads, and the driven line, forced. */
function craft(pending, phase, line) {
  const m = entryState().clone();
  m.mem8[PENDING] = pending;
  m.mem8[PHASE] = phase;
  m.io.latch[LATCH_BIT] = line;
  return m;
}

const PENDINGS = [0, 1, 2, 255];
const PHASES = Array.from({ length: 256 }, (_unused, p) => p);
const LINES = [0, 1];
const SWEEP_SIZE = PENDINGS.length * PHASES.length * LINES.length;

function sweepCaught(candidate, diff = unitDiff) {
  let caught = 0;
  for (const line of LINES) {
    for (const pending of PENDINGS) {
      for (const phase of PHASES) if (diff(candidate, craft(pending, phase, line))) caught++;
    }
  }
  return caught;
}

/** Every register that differs ANYWHERE in the crafted space, so a register that moves only on an
 * arm one entry never reaches is still seen. */
function movedRegisters(candidate) {
  const moved = new Set();
  for (const line of LINES) {
    for (const pending of PENDINGS) {
      for (const phase of PHASES) {
        const machine = craft(pending, phase, line);
        const a = machine.clone();
        const b = machine.clone();
        oracle(a);
        candidate(b);
        for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
      }
    }
  }
  return REG_FIELDS.filter((k) => moved.has(k));
}

function wholeRunCells(candidate) {
  const base = makeMachine();
  const baseFrames = base.runFrames(CORPUS_FRAMES);
  let fired = 0;
  const host = makeMachine(new Map([[TARGET, withOmittedRet((mm) => (fired++, candidate(mm)))]]));
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

const drive = (m, value) => m.mem.write8(OUTPUT_LINE, value, STORE_BUS_OFFSET);

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: never touches the line, so the pulse train is silent while the counters still run. */
function brokenSilentLine(m) {
  const { mem8 } = m;
  if (mem8[PENDING] === 0) return;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH;
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === 0) mem8[PENDING] = (mem8[PENDING] - 1) & 0xff;
}

/** BUG: runs even with nothing pending, so the line pulses forever. */
function brokenNoPendingGate(m) {
  const { mem8 } = m;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH;
    drive(m, 1);
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === 0) {
    mem8[PENDING] = (mem8[PENDING] - 1) & 0xff;
    return;
  }
  if (phase === HALFWAY) drive(m, 0);
}

/** BUG: the drop is a threshold rather than an equality, so it is re-issued every later step. */
function brokenDropIsThreshold(m) {
  const { mem8 } = m;
  if (mem8[PENDING] === 0) return;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH;
    drive(m, 1);
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === 0) {
    mem8[PENDING] = (mem8[PENDING] - 1) & 0xff;
    return;
  }
  if (phase <= HALFWAY) drive(m, 0);
}

/** BUG: the midpoint is one out, so the two halves of a pulse are unequal. */
function brokenHalfwayOffByOne(m) {
  const { mem8 } = m;
  if (mem8[PENDING] === 0) return;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH;
    drive(m, 1);
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === 0) {
    mem8[PENDING] = (mem8[PENDING] - 1) & 0xff;
    return;
  }
  if (phase === HALFWAY - 1) drive(m, 0);
}

/** BUG: the phase is armed one short, so every pulse is a step narrow. */
function brokenPhaseOffByOne(m) {
  const { mem8 } = m;
  if (mem8[PENDING] === 0) return;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH - 1;
    drive(m, 1);
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === 0) {
    mem8[PENDING] = (mem8[PENDING] - 1) & 0xff;
    return;
  }
  if (phase === HALFWAY) drive(m, 0);
}

/** BUG: the pending count is never spent, so the train never ends. */
function brokenNeverSpends(m) {
  const { mem8 } = m;
  if (mem8[PENDING] === 0) return;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH;
    drive(m, 1);
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === HALFWAY) drive(m, 0);
}

/** BUG: the line is raised as a whole byte rather than the one bit the latch takes. */
function brokenRaisesWrongValue(m) {
  const { mem8 } = m;
  if (mem8[PENDING] === 0) return;
  if (mem8[PHASE] === 0) {
    mem8[PHASE] = PHASE_LENGTH;
    drive(m, 0);
    return;
  }
  const phase = (mem8[PHASE] - 1) & 0xff;
  mem8[PHASE] = phase;
  if (phase === 0) {
    mem8[PENDING] = (mem8[PENDING] - 1) & 0xff;
    return;
  }
  if (phase === HALFWAY) drive(m, 0);
}

const TWINS = [
  ["no-op", brokenNoOp, 1536, 0],
  ["silent-line", brokenSilentLine, 6, 0],
  ["no-pending-gate", brokenNoPendingGate, 512, 1765],
  ["drop-is-threshold", brokenDropIsThreshold, 69, 0],
  ["halfway-off-by-one", brokenHalfwayOffByOne, 6, 0],
  ["phase-off-by-one", brokenPhaseOffByOne, 6, 0],
  ["never-spends", brokenNeverSpends, 6, 0],
  ["raises-wrong-value", brokenRaisesWrongValue, 6, 0],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: pulseSlot2CoinCounter == oracle on RAM and the latch", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  pulseSlot2CoinCounter(b);
  assert.deepEqual(allDiffs(a, b), [], "RAM diverged with nothing masked");
  assert.deepEqual([...a.io.latch], [...b.io.latch], "the output latch diverged");
  console.log(
    `  EQUAL: pending=${entryState().mem8[PENDING]} phase=${entryState().mem8[PHASE]}; ` +
      "RAM and latch identical, with nothing masked",
  );
});

test("REAL DISPATCH IS VACUOUS, MEASURED: a no-op passes at the captured entry", { skip }, () => {
  assert.equal(
    entryState().mem8[PENDING],
    0,
    "the captured entry now has work to do, so this file's vacuity finding is stale",
  );
  assert.equal(
    unitDiff(brokenNoOp, entryState()),
    null,
    "a no-op is now CAUGHT at the real dispatch, which would make the corpus a real gate — " +
      "re-derive the holes above rather than leaving them",
  );
  console.log("  VACUOUS: the captured entry has nothing pending, so a no-op passes there");
});

test("NOT VACUOUS, CRAFTED: the same no-op FAILS once there is work to do", { skip }, () => {
  const d = unitDiff(brokenNoOp, craft(1, 0, 0));
  assert.notEqual(d, null, "the diff passed a no-op on an entry with a pulse pending");
  console.log(`  NOT VACUOUS: the empty candidate is caught on a crafted entry — ${show(d)}`);
});

test("THE LINE IS INVISIBLE TO RAM, MEASURED: a silent twin passes the RAM diff", { skip }, () => {
  assert.equal(
    sweepCaught(brokenSilentLine, ramDiff),
    0,
    "RAM now catches a candidate that never drives the line, so this file's reason for comparing " +
      "the latch is stale and the arms below should be re-derived",
  );
  assert.ok(
    sweepCaught(brokenSilentLine) > 0,
    "the latch comparison must catch what the RAM diff cannot, or neither arm is a gate",
  );
  console.log(
    `  LINE INVISIBLE: RAM catches the silent twin 0 times, the latch catches it ` +
      `${sweepCaught(brokenSilentLine)} of ${SWEEP_SIZE}`,
  );
});

test("EXCLUDED, deliberately: measured over the whole crafted space, not at one entry", { skip }, () => {
  const moved = movedRegisters(pulseSlot2CoinCounter);
  const unexpected = moved.filter((k) => !EXCLUDED.includes(k));
  assert.deepEqual(unexpected, [], "a register diverged outside the excluded set");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc; the driven line is latch bit ${LATCH_BIT}`);
});

test("CORPUS SHAPE: every real dispatch is the idle arm, and the count is exact", { skip }, () => {
  const s = session();
  assert.equal(s.dispatches, DISPATCHES, "the dispatch count moved");
  assert.equal(
    s.arms.idle,
    DISPATCHES,
    "a real dispatch now reaches a working arm, so the vacuity finding above and every zero in " +
      "the per-twin real counts below have to be re-derived",
  );
  console.log(`  CORPUS SHAPE: ${s.dispatches} real dispatches; arms ${JSON.stringify(s.arms)}`);
});

test("CORPUS: every dispatch of the real session replays identically", { skip }, () => {
  assert.equal(session().caught, 0, "the rewrite diverged on a real dispatch");
  console.log(`  CORPUS: ${session().dispatches} real dispatches, identical on each`);
});

test("EXHAUSTIVE: 256 phases x four pending counts x both line states", { skip }, () => {
  assert.equal(sweepCaught(pulseSlot2CoinCounter), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} pending x phase comparisons identical`);
});

test("WHOLE-MACHINE: the session differs only where the interrupt pushes", { skip }, () => {
  const r = wholeRunCells(pulseSlot2CoinCounter);
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
