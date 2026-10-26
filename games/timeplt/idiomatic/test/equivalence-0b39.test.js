// SPDX-License-Identifier: GPL-3.0-only
/**
 * flashCopyrightLine — memory-equivalent to the frozen oracle at ROM 0x0B39.
 *
 * WHAT IT IS. Five instructions: read one counter cell, test its lowest bit, and leave by one of
 * two transfers — a tail jump to 0x0B46, or a fixed pair loaded into the command registers and a
 * tail jump to the ring append at 0x0038. BOTH destinations are already decompiled, so the rewrite
 * calls them directly and dissolving the two transfers belongs to this caller's unit. The whole
 * content of the entry is therefore WHICH argument goes out with a fixed command, and the answer
 * is one bit of one cell.
 *
 * GATE: strict unit-capture over two replayed real sessions, an exhaustive sweep of the deciding
 *   cell crossed with the ring priors, and a whole-machine replay. What it exercises, holes stated:
 *
 *   1. EQUAL at the real dispatch — RAM identical outside the scratch window, and the command pair
 *      the rewrite leaves behind identical too.
 *   2. THE DEAD STACK SCRATCH IS THE ONE EXCLUSION, exactly [SP-2, SP). The oracle's append
 *      brackets its work with a push/pop; the rewrite models no stack. Every arm PINS the window:
 *      each walks the whole dump and asserts no divergence escapes it, and the corpus arm asserts
 *      the exact set of offsets that were ever dirty, so it cannot quietly widen.
 *   3. EXCLUDED, DELIBERATELY — the register file may differ only within {a, f, sp}, plus pc; a
 *      register outside the set fails and a rewrite that clobbers fewer of them does not. The
 *      command pair is NOT in that set: it is a live-out, compared explicitly.
 *   4. BOTH ARMS ARE REAL — the corpus arm asserts that both parities of the deciding bit occur,
 *      so neither branch is covered only by craft.
 *   5. EXHAUSTIVE — all 256 values of the deciding cell against four ring guard bytes, which is
 *      the only arm that reaches a congested ring and the drop it causes.
 *   6. WHOLE-MACHINE — two whole sessions with the rewrite wired through the omitted-return seam.
 *      Over a session the dead bytes are TWO pairs rather than one, because the entry is reached
 *      at two call depths; the arm asserts that exact set. This is what holds the "the registers
 *      are dead" claim, which no unit arm can see, since it is a claim about a later reader.
 *   7. TEETH — six twins at six distinct behaviours, each with its exact catch counts declared.
 *
 * HOLE: the deciding cell is stepped once per frame from outside, so a real session presents both
 * parities in strict alternation and nothing else. Whether some state makes it stand still is not
 * covered, and would not change what this entry does with it.
 * HOLE: no real dispatch in either session finds the ring congested, which the corpus arm asserts
 * rather than assumes — so the DROP branch of the append is reached only by the crafted sweep.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-0b39.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, romsPresent } from "./_harness.js";
import { withOmittedRet } from "../../machine.js";
import { flashCopyrightLine } from "../flashCopyrightLine.js";
import { enqueueFixedCommandOnRing } from "../enqueueFixedCommandOnRing.js";
import { postCommand } from "../postCommand.js";
import { loc_0b39 as oracle } from "../../translated/loc_0b39.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { COMMAND_RING, FRAME_TICK } from "../names.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x0b39;

/** The cell whose lowest bit is the whole decision, and the two pairs it chooses between. */
const COMMAND = 1;
const ARGUMENT_WHEN_EVEN = 31;
const ARGUMENT_WHEN_ODD = 0;

const WRITE_CURSOR = 0xa9b2;

const SCRATCH_BYTES = 2;
const SCRATCH_OFFSETS = [-2, -1];
const EXCLUDED = ["a", "f", "sp"];

const CORPUS_FRAMES = 2000;

/** Dispatches each session produces. Measured; a move here is a finding, not a tolerance. */
const DISPATCHES = { shared: 205, attract: 514 };

const TAPES = [
  ["shared", {}],
  ["attract", { tape: [] }],
];

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");

/** Every differing byte of two dumps, as {addr, a, b} — the scratch window included. */
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

/** Oracle vs candidate on clones of one machine: masked RAM first, then the command pair. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const stray = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (stray) return stray;
  if (a.regs.d !== b.regs.d) return { addr: null, a: a.regs.d, b: b.regs.d };
  if (a.regs.e !== b.regs.e) return { addr: null, a: a.regs.e, b: b.regs.e };
  return null;
}

/** Replay one whole session, comparing at EVERY dispatch. */
function replaySession(opts, candidate) {
  let dispatches = 0;
  let caught = 0;
  let free = 0;
  const parities = new Set();
  const dirty = new Set();
  const m = makeMachine(
    new Map([[TARGET, (mm) => {
      dispatches++;
      parities.add(mm.mem8[FRAME_TICK] & 1);
      if (mm.mem8[COMMAND_RING + mm.mem8[WRITE_CURSOR]] & 0x80) free++;
      const sp = mm.regs.sp;
      const a = mm.clone();
      const b = mm.clone();
      oracle(a);
      candidate(b);
      for (const d of allDiffs(a, b)) if (inScratch(d.addr, sp)) dirty.add(d.addr - sp);
      if (unitDiff(candidate, mm)) caught++;
      return oracle(mm);
    }]]),
    opts,
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, caught, free, parities, dirty };
}

let cache = null;
function sessions() {
  if (!cache) cache = TAPES.map(([label, opts]) => ({ label, ...replaySession(opts, flashCopyrightLine) }));
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

/** A real captured machine with the deciding cell and the ring prior forced. */
function craft(counter, guard) {
  const m = entryState().clone();
  m.mem8[FRAME_TICK] = counter;
  m.mem8[COMMAND_RING + m.mem8[WRITE_CURSOR]] = guard;
  return m;
}

const GUARDS = [0xff, 0x80, 0x7f, 0x00];
const COUNTERS = Array.from({ length: 256 }, (_unused, c) => c);
const SWEEP_SIZE = GUARDS.length * COUNTERS.length;

function sweepCaught(candidate) {
  let caught = 0;
  for (const guard of GUARDS) {
    for (const counter of COUNTERS) if (unitDiff(candidate, craft(counter, guard))) caught++;
  }
  return caught;
}

/** Every cell that EVER differs between an all-oracle session and one with the rewrite wired. */
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
    const x = baseFrames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.stateOffsetToAddr(o));
  }
  const live = liveStackDiffs(baseFrames, hostFrames, floors, (o) => base.stateOffsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw, stopped: host.stoppedBy };
}

/**
 * The dead bytes a WHOLE session leaves differing. Two pairs, not one: this entry is reached at
 * two call depths, and each leaves the return address the oracle pops and the rewrite does not.
 * Measured; every one lies under a stack pointer, which the arm re-checks rather than assumes.
 */
const SESSION_SCRATCH = [0xafe2, 0xafe3, 0xaffd, 0xaffe];

// ── the twins ───────────────────────────────────────────────────────────────────────────
// Six ways to get a five-instruction entry wrong: three about WHICH pair goes out, one that
// reads the wrong bit of the deciding cell, one that ignores the cell entirely, and one that
// queues correctly but drops the pair the registers are supposed to be left holding.

/** BUG: does nothing at all — the tell that a gate is measuring an unreached routine. */
function brokenNoOp() {}

/** BUG: always takes the other entry's pair, so the odd turn queues the wrong argument. */
function brokenAlwaysOtherPair(m) {
  enqueueFixedCommandOnRing(m);
}

/** BUG: always queues this entry's own pair, so the even turn queues the wrong argument. */
function brokenAlwaysOwnPair(m) {
  m.regs.d = COMMAND;
  m.regs.e = ARGUMENT_WHEN_ODD;
  postCommand(m, COMMAND, ARGUMENT_WHEN_ODD);
}

/** BUG: the arms are the right way round for the wrong bit — bit one instead of bit zero. */
function brokenWrongBit(m) {
  if ((m.mem8[FRAME_TICK] & 2) === 0) {
    enqueueFixedCommandOnRing(m);
    return;
  }
  brokenAlwaysOwnPair(m);
}

/** BUG: the sense of the test is inverted, so each turn gets the other turn's pair. */
function brokenInverted(m) {
  if ((m.mem8[FRAME_TICK] & 1) === 1) {
    enqueueFixedCommandOnRing(m);
    return;
  }
  brokenAlwaysOwnPair(m);
}

/** BUG: queues the right pair and leaves the registers holding whatever the caller had. */
function brokenDropsThePair(m) {
  if ((m.mem8[FRAME_TICK] & 1) === 0) {
    postCommand(m, COMMAND, ARGUMENT_WHEN_EVEN);
    return;
  }
  postCommand(m, COMMAND, ARGUMENT_WHEN_ODD);
}

/** Per twin: its exact catch count over the crafted sweep and in each session, both measured. */
const TWINS = [
  ["no-op", brokenNoOp, 1024, [205, 514]],
  ["always-other-pair", brokenAlwaysOtherPair, 512, [102, 257]],
  ["always-own-pair", brokenAlwaysOwnPair, 512, [103, 257]],
  ["wrong-bit", brokenWrongBit, 512, [103, 257]],
  ["inverted", brokenInverted, 1024, [205, 514]],
  ["drops-the-pair", brokenDropsThePair, 1024, [205, 514]],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("EQUAL at the real dispatch: flashCopyrightLine == oracle outside the scratch window", { skip }, () => {
  const sp = entryState().regs.sp;
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  flashCopyrightLine(b);

  const strays = allDiffs(a, b).filter((d) => !inScratch(d.addr, sp));
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.equal(a.regs.d, b.regs.d, "the command byte left behind");
  assert.equal(a.regs.e, b.regs.e, "the argument byte left behind");
  console.log(
    `  EQUAL: counter=${entryState().mem8[FRAME_TICK]} sp=${hex4(sp)}; identical outside [SP-2, SP)`,
  );
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked comparison", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("EXCLUDED, deliberately: registers, pc and the scratch push, and nothing outside", { skip }, () => {
  const a = entryState().clone();
  const b = entryState().clone();
  oracle(a);
  flashCopyrightLine(b);
  const moved = REG_FIELDS.filter((k) => a.regs[k] !== b.regs[k]);
  assert.deepEqual(
    moved.filter((k) => !EXCLUDED.includes(k)),
    [],
    "a register outside the declared excluded set diverged: only the accumulator, the flag byte " +
      "and the stack pointer may differ — the command pair is a live-out and is compared above",
  );
  assert.notEqual(a.pc, b.pc, "the oracle's return moves pc; the rewrite returns to JS");
  console.log(`  EXCLUDED: ${EXCLUDED.join(", ")} and pc`);
});

test("BOTH ARMS ARE REAL: each session presents both parities, none with a full ring", { skip }, () => {
  for (const s of sessions()) {
    assert.equal(s.dispatches, DISPATCHES[s.label], `the ${s.label} dispatch count moved`);
    assert.deepEqual([...s.parities].sort(), [0, 1], `the ${s.label} tape reached only one arm`);
    assert.equal(s.free, s.dispatches, `the ${s.label} tape found the ring congested somewhere`);
    assert.deepEqual(
      [...s.dirty].sort((x, y) => x - y),
      SCRATCH_OFFSETS,
      `the ${s.label} tape dirtied a different window under the stack pointer`,
    );
  }
  console.log(
    `  BOTH ARMS: ${sessions().map((s) => `${s.label} ${s.dispatches}`).join(", ")} dispatches, ` +
      "both parities, ring free at every one",
  );
});

test("CORPUS: every dispatch of two real sessions replays identically", { skip }, () => {
  let total = 0;
  for (const s of sessions()) {
    assert.equal(s.caught, 0, `the rewrite diverged on ${s.caught} ${s.label} dispatches`);
    total += s.dispatches;
  }
  console.log(`  CORPUS: ${total} real dispatches over two sessions, identical on each`);
});

test("EXHAUSTIVE: all 256 counter values against four ring priors", { skip }, () => {
  assert.equal(sweepCaught(flashCopyrightLine), 0, "the rewrite diverged somewhere in the crafted space");
  console.log(`  EXHAUSTIVE: ${SWEEP_SIZE} counter x guard comparisons identical`);
});

for (const [label, opts] of TAPES) {
  test(`WHOLE-MACHINE: the ${label} session differs only in the scratch window`, { skip }, () => {
    const r = wholeRunCells(flashCopyrightLine, opts);
    assert.equal(r.threw, null, `the run threw: ${r.threw}`);
    assert.equal(r.stopped, null, `a run stopped early (${r.stopped})`);
    assert.equal(r.frames, CORPUS_FRAMES, `compared ${r.frames} of ${CORPUS_FRAMES} frames`);
    assert.ok(r.fired > 0, "vacuous: the override never dispatched");
    assert.deepEqual(r.cells, SESSION_SCRATCH, "a divergence escaped the scratch window");
    console.log(
      `  WHOLE-MACHINE/${label}: ${r.frames} frames, ${r.fired} dispatches, only ` +
        `${r.cells.map(hex4).join(" ")} differ`,
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
