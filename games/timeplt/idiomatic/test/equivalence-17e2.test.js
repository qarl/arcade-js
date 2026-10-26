// SPDX-License-Identifier: GPL-3.0-only
/**
 * foldImageBlockIntoSignatureThenAdvanceSequence — memory-equivalent to the frozen oracle at ROM 0x17E2.
 *
 * GATE: unit-capture with ONE measured exclusion, a captured real corpus from four sessions, a
 *   sweep that is exhaustive over the routine's whole varying input by decomposition, a
 *   whole-machine replay, and teeth.
 *
 *   THE FROZEN ROUTINE PUSHES AND THE REWRITE DOES NOT. It brackets two calls, both at the same
 *   depth, so the bytes just below the entry stack pointer are dead scratch on one side only. The
 *   window is MEASURED by the WRITE-SET arm rather than read off the instruction stream, every
 *   later arm walks the WHOLE dump and asserts nothing escapes it, and no arm uses the
 *   first-differing-byte helper, which cannot express "differs only inside the window".
 *
 *   ALMOST EVERY INPUT IS A CONSTANT. The block folded, its length, the byte the running total
 *   starts from and the second pointer walked alongside are all fixed in the program image, so
 *   what a crafted entry can vary is the register file it arrives with and the prior contents of
 *   the three cells written. Both are swept exhaustively below. The program image itself cannot be
 *   varied — writes to it are dropped — which is why the twins that must discriminate the block
 *   read a DIFFERENT block rather than a changed one.
 *
 *   WHERE THE LIVE-OUT COMES FROM. It is read off the frozen routine's exit successor, not off the
 *   rewrite. Its only exit is a tail jump to ROM 0x0F1A, which ends in a plain `ret`, so whatever
 *   that leaves goes to whoever reached THIS routine — and nothing calls it: no `call 0x17E2` in
 *   the transcribed image, and no `m.call(0x17e2)` either. The ENTRY REACH arm below shows what it
 *   is reached by instead: every captured dispatch arrives holding this very routine's own address,
 *   which is what a computed dispatch through a register looks like. Traced with a probe on all
 *   three `jp (hl)` sites in the transcribed image, both undriven dispatches came in through ROM
 *   0x0B93's inline table and then ROM 0x0030's, nested. Arms of those tables leave wholly
 *   different register files from one another, so nothing downstream can be reading one. Hence
 *   memory-only.
 *
 *   THE REGISTER CEILING IS A TRIPWIRE, NOT THE CONTRACT. Because the live-out is memory-only, no
 *   register is owned by this gate; the declared set is a CEILING with headroom over what is
 *   measured, so it refuses no rewrite that clobbers fewer registers, and it still catches a
 *   rewrite reaching an index or shadow register this routine has no business touching.
 *
 *   THE REWRITE DROPS ONE STORE THE FROZEN ROUTINE MAKES — a constant into a register that the
 *   fold then overwrites on every step of its run. That is licensed by a property of the FROZEN
 *   routine, not of the rewrite, so the DEAD STORE arm measures it on the frozen side alone: the
 *   frozen routine is run from entries differing only in that register and leaves the same value.
 *
 * What it exercises, holes stated:
 *   1. CONTRACT — the shared unit harness reaches the routine; its first-byte verdict is checked
 *      to be inside the stack rather than treated as the contract.
 *   2. WRITE-SET — the addresses the frozen routine moves, measured, split into cells and scratch.
 *   3. EQUAL at the real dispatch — the whole dump outside the window, and the three cells.
 *   4. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell.
 *   5. ENTRY REACH — dispatches per session and what every entry arrives holding.
 *   6. CORPUS — every captured dispatch of four sessions.
 *   7. EXCLUDED, as a CEILING — over the whole register sweep, nothing outside the set moves.
 *   8. DEAD STORE — the frozen routine's own constant store is measured dead, on the frozen side.
 *   9. CELL SWEEP — all 256 prior values of EACH of the three written cells. The three writes take
 *      their values from a constant, from the program image, and from that cell's own prior value,
 *      which arm 2 corroborates, so sweeping each independently is exhaustive over the three.
 *  10. REGISTER SWEEP — all 256 entry values of each byte register, and a cross of the pairs.
 *  11. THE REUSED MACHINES ARE SOUND — clone-per-point masked agreement on a sample.
 *  12. WHOLE-MACHINE — an undriven session with the rewrite wired, diffed every frame, differing
 *      only on the frozen side's own call bracket, each differing address asserted to be a stack
 *      address and the set pinned.
 *  13. SEED — the byte the running total starts from is measured, because it is ZERO in this image
 *      and that is what makes one of the twins below uncatchable.
 *  14. TEETH — nine twins with exact catch counts over the sweep, the corpus and the whole run.
 *  15. TWO RECORDED-INVISIBLE TWINS, caught by nothing at all, each for a stated reason: one moves
 *      only a register, which a memory-only contract does not own, and one drops a seed byte this
 *      image holds at zero. Their zeros are ASSERTED, and each assertion is accompanied, in the
 *      same arm, by the same three instruments catching a twin that does move a cell — without
 *      that control three zeros would be indistinguishable from three blind instruments.
 *
 * HOLE: the folded block is read out of the program image, which cannot be varied here, so the
 * arms that hold this file to THAT block are the twins reading a different one — not a sweep.
 * HOLE: the corpus is one or two dispatches per session; the sweeps carry this gate.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-17e2.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";

import { makeMachine, COIN_FRAME, START_FRAME, romsPresent } from "./_harness.js";
import { foldImageBlockIntoSignatureThenAdvanceSequence } from "../foldImageBlockIntoSignatureThenAdvanceSequence.js";
import { foldBlockIntoTotal } from "../foldBlockIntoTotal.js";
import { advanceSequenceSubStep } from "../advanceSequenceSubStep.js";
import { loc_17e2 as oracle } from "../../translated/loc_17e2.js";
import { deadStackBelow, unitEquivalence } from "../../../../core/equivalence.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { u16 } from "../../../../core/int.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x17e2;
const skip = romsPresent() ? false : "ROM images are gitignored and absent";

const FLAG_CELL = 0xaa3f;
const SIGNATURE_CELL = 0xaa6f;
const SEQUENCE_SUBSTEP = 0xa9ac;

/** Everything the frozen routine writes, so the sweep can put a machine back as it found it. */
const WRITTEN = [FLAG_CELL, SIGNATURE_CELL, SEQUENCE_SUBSTEP];
/** Measured by the WRITE-SET arm: one call bracket, re-used by both calls, below the entry. */
const SCRATCH_BYTES = 2;

/** The block the frozen routine folds, and the one the twins fold instead. */
const BLOCK_START = 0x335e;
const BLOCK_LENGTH = 30;
const SECOND_WALK_START = 0x17b9;
const OTHER_WALK_START = 0x1900;
const SEED_BYTE = 0x27c0;
const ALL_BITS = 255;

const VALUES = 256;
const CROSS_CHECK_POINTS = 300;

/**
 * A CEILING with headroom, not the contract: the live-out is memory-only, so this arm exists to
 * catch a rewrite reaching a register the frozen routine never touches at all.
 */
const EXCLUDED = ["a", "f", "b", "c", "d", "e", "h", "l", "sp"];

const CORPUS_FRAMES = 6000;
const WHOLE_FRAMES = 1200;
const REACH_FRAMES = 900;
const RET_TSTATES = 10;

/** Measured: a whole run differs on the frozen side's own call bracket and nowhere else. */
const WHOLE_RUN_CELLS = ["0xafe4", "0xafe5"];

const STACK_FLOOR = 0xaf00;
const STACK_TOP = 0xb000;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;
const SECOND_COIN = 40;

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: frozen=${d.a} candidate=${d.b}` : "identical");

function turnTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: CORPUS_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let i = 0; i < 60; i++) {
    tape.push({ frame, port: IN1, bits: compass[i % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const TWO_PLAYER_TAPE = [
  { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
  { frame: COIN_FRAME + SECOND_COIN, port: IN0, bits: 0x01, dur: HOLD },
  { frame: START_FRAME, port: IN0, bits: 0x10, dur: HOLD },
];

const attractMachine = (overrides) => makeMachine(overrides, { tape: [] });
const sharedMachine = (overrides) => makeMachine(overrides);
const turningMachine = (overrides) => makeMachine(overrides, { tape: turnTape() });
const twoPlayerMachine = (overrides) => makeMachine(overrides, { tape: TWO_PLAYER_TAPE });

const SESSIONS = [
  ["attract", attractMachine],
  ["shared", sharedMachine],
  ["turning", turningMachine],
  ["twoplayer", twoPlayerMachine],
];

/** Dispatches each session produces in CORPUS_FRAMES frames. Measured; a move here is a finding. */
const DISPATCHES = { attract: 2, shared: 1, turning: 1, twoplayer: 1 };

// ── the masked comparison ───────────────────────────────────────────────────────────────

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

/** The whole dump minus the scratch window. Clone per point. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  return allDiffs(a, b).find((d) => !inScratch(d.addr, sp)) ?? null;
}

// ── capturing real dispatches ───────────────────────────────────────────────────────────

function captureSession(factory) {
  let dispatches = 0;
  const entries = [];
  const held = new Set();
  const m = factory(
    new Map([[TARGET, (mm) => {
      dispatches++;
      held.add(mm.regs.hl);
      entries.push(mm.clone());
      return oracle(mm);
    }]]),
  );
  const frames = m.runFrames(CORPUS_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  assert.equal(frames.length, CORPUS_FRAMES, "session ran short");
  return { dispatches, entries, held };
}

let sessionCache = null;
function sessions() {
  if (!sessionCache) {
    sessionCache = SESSIONS.map(([label, factory]) => ({ label, ...captureSession(factory) }));
  }
  return sessionCache;
}

const entryState = () => sessions()[0].entries[0];

function corpusCaught(candidate) {
  return sessions().map((s) => s.entries.filter((e) => unitDiff(candidate, e) !== null).length);
}

// ── the sweep, on two reused machines ───────────────────────────────────────────────────

let arena = null;
function pair() {
  if (!arena) arena = [entryState().clone(), entryState().clone()];
  return arena;
}

const BYTE_REGISTERS = ["a", "b", "c", "d", "e", "h", "l"];

/** Put a machine back exactly as the captured entry left it, then seat one point on it. */
function seat(m, cells, regs) {
  const seed = entryState();
  m.regs.copyFrom(seed.regs);
  for (const addr of WRITTEN) m.mem8[addr] = seed.mem8[addr];
  for (let i = 1; i <= SCRATCH_BYTES; i++) {
    m.mem8[u16(seed.regs.sp - i)] = seed.mem8[u16(seed.regs.sp - i)];
  }
  for (const [addr, v] of cells) m.mem8[addr] = v;
  for (const [k, v] of regs) m.regs[k] = v;
}

/**
 * One point. The comparison is the three written cells rather than the whole dump, which is what
 * keeps the sweeps affordable; the clone-per-point arm and the captured corpus walk the whole
 * dump, and the hole that leaves is stated in the header.
 */
function pointDiffers(candidate, cells, regs) {
  const [a, b] = pair();
  seat(a, cells, regs);
  seat(b, cells, regs);
  oracle(a);
  candidate(b);
  return WRITTEN.some((addr) => a.mem8[addr] !== b.mem8[addr]);
}

function cellSweepCaught(candidate) {
  let caught = 0;
  for (const addr of WRITTEN) {
    for (let v = 0; v < VALUES; v++) if (pointDiffers(candidate, [[addr, v]], [])) caught++;
  }
  return caught;
}

function registerSweepCaught(candidate) {
  let caught = 0;
  for (const k of BYTE_REGISTERS) {
    for (let v = 0; v < VALUES; v++) if (pointDiffers(candidate, [], [[k, v]])) caught++;
  }
  for (const hl of [0, 1, BLOCK_START, SECOND_WALK_START, 0xffff]) {
    for (const de of [0, 1, BLOCK_START, SECOND_WALK_START, 0xffff]) {
      if (pointDiffers(candidate, [], [["hl", hl], ["de", de]])) caught++;
    }
  }
  return caught;
}

const sweepCaught = (candidate) => cellSweepCaught(candidate) + registerSweepCaught(candidate);
const SWEEP_POINTS = WRITTEN.length * VALUES + BYTE_REGISTERS.length * VALUES + 25;

// ── the whole-machine masked diff ───────────────────────────────────────────────────────

function hosted(candidate) {
  return (mm) => {
    const probe = mm.clone();
    const before = probe.cycles;
    oracle(probe);
    const total = probe.cycles - before;
    candidate(mm);
    mm.tick(total - RET_TSTATES);
    mm.ret(RET_TSTATES);
  };
}

let baselineRun = null;
function baseline() {
  if (!baselineRun) {
    const base = attractMachine();
    const frames = base.runFrames(WHOLE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = attractMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(WHOLE_FRAMES);
  } catch (e) {
    threw = String(e).slice(0, 70);
  }
  const cells = new Set();
  const n = Math.min(base.frames.length, hostFrames.length);
  for (let i = 0; i < n; i++) {
    const x = base.frames[i];
    const y = hostFrames[i];
    for (let o = 0; o < x.length; o++) if (x[o] !== y[o]) cells.add(base.offsetToAddr(o));
  }
  const live = liveStackDiffs(base.frames, hostFrames, floors, (o) => base.offsetToAddr(o));
  // A cell that differs in a live frame fails the run like a throw: it is never stack scratch.
  if (live.length && threw === null) threw = `live stack ${live.map((c) => c.toString(16)).join(",")} differs at or above a frame sample's SP`;
  return { cells: [...cells].sort((p, q) => p - q), frames: n, fired, threw };
}

// ── the twins ───────────────────────────────────────────────────────────────────────────

const fold = (m, start, length, walk) =>
  foldBlockIntoTotal(m, m.mem8[SEED_BYTE], start, walk, length);

/** BUG: does nothing at all. */
function brokenNoOp() {}

/** BUG: the flag cell is left standing at whatever it held. */
function brokenFlagNotRaised(m) {
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START, BLOCK_LENGTH, SECOND_WALK_START);
  advanceSequenceSubStep(m);
}

/** BUG: the flag cell is raised one short of all bits. */
function brokenFlagOneShort(m) {
  m.mem8[FLAG_CELL] = ALL_BITS - 1;
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START, BLOCK_LENGTH, SECOND_WALK_START);
  advanceSequenceSubStep(m);
}

/**
 * BUG: the running total starts from nothing instead of from the image byte. MEASURED INVISIBLE:
 * that byte is zero in this image, so this twin and the correct routine agree everywhere. It is
 * kept for exactly that reason, and the arm below asserts the zero rather than the catch.
 */
function brokenUnseeded(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] = foldBlockIntoTotal(m, 0, BLOCK_START, SECOND_WALK_START, BLOCK_LENGTH);
  advanceSequenceSubStep(m);
}

/** BUG: the running total starts from the image byte NEXT to the right one. */
function brokenSeededElsewhere(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] =
    foldBlockIntoTotal(m, m.mem8[SEED_BYTE + 1], BLOCK_START, SECOND_WALK_START, BLOCK_LENGTH);
  advanceSequenceSubStep(m);
}

/** BUG: the last byte of the block is left out of the total. */
function brokenLengthShort(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START, BLOCK_LENGTH - 1, SECOND_WALK_START);
  advanceSequenceSubStep(m);
}

/** BUG: the block is taken one byte along, so it runs one past its end. */
function brokenBlockShifted(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START + 1, BLOCK_LENGTH, SECOND_WALK_START);
  advanceSequenceSubStep(m);
}

/** BUG: the two cells change places. */
function brokenCellsSwapped(m) {
  const total = fold(m, BLOCK_START, BLOCK_LENGTH, SECOND_WALK_START);
  m.mem8[SIGNATURE_CELL] = ALL_BITS;
  m.mem8[FLAG_CELL] = total;
  advanceSequenceSubStep(m);
}

/** BUG: the inner sequence index is left where it was. */
function brokenSequenceNotAdvanced(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START, BLOCK_LENGTH, SECOND_WALK_START);
}

/** BUG: the index is stepped twice. */
function brokenSequenceAdvancedTwice(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START, BLOCK_LENGTH, SECOND_WALK_START);
  advanceSequenceSubStep(m);
  advanceSequenceSubStep(m);
}

/**
 * The DELIBERATELY INVISIBLE twin: the second pointer is walked from somewhere else entirely. It
 * changes one register and no cell, and a memory-only contract does not own registers, so every
 * instrument in this file is expected to report ZERO. That zero is the assertion.
 */
function brokenSecondWalkElsewhere(m) {
  m.mem8[FLAG_CELL] = ALL_BITS;
  m.mem8[SIGNATURE_CELL] = fold(m, BLOCK_START, BLOCK_LENGTH, OTHER_WALK_START);
  advanceSequenceSubStep(m);
}

const TWINS = [
  ["no-op", brokenNoOp, 2585, [2, 1, 1, 1], true],
  ["flag-not-raised", brokenFlagNotRaised, 2584, [2, 1, 1, 1], true],
  ["flag-one-short", brokenFlagOneShort, 2585, [2, 1, 1, 1], true],
  ["seeded-elsewhere", brokenSeededElsewhere, 2585, [2, 1, 1, 1], true],
  ["length-short", brokenLengthShort, 2585, [2, 1, 1, 1], true],
  ["block-shifted", brokenBlockShifted, 2585, [2, 1, 1, 1], true],
  ["cells-swapped", brokenCellsSwapped, 2585, [2, 1, 1, 1], true],
  ["sequence-not-advanced", brokenSequenceNotAdvanced, 2585, [2, 1, 1, 1], true],
  ["sequence-advanced-twice", brokenSequenceAdvancedTwice, 2585, [2, 1, 1, 1], true],
];

/**
 * Twins nothing in this file can catch, each for a stated reason: one moves only a register, which
 * a memory-only contract does not own, and one differs only by a byte this image holds at zero.
 */
const INVISIBLE_TWINS = [
  ["second-walk-elsewhere", brokenSecondWalkElsewhere, "it moves a register and no cell"],
  ["unseeded", brokenUnseeded, "the byte it drops is zero in this image"],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("CONTRACT: the shared unit harness reaches the routine", { skip }, () => {
  let floor = null; // the entry SP: the harness's first oracle call is at the captured entry
  const tapped = (mm) => { floor ??= mm.regs.sp; return oracle(mm); };
  const r = unitEquivalence(attractMachine, TARGET, tapped, foldImageBlockIntoSignatureThenAdvanceSequence, { maxFrames: REACH_FRAMES });
  const onlyScratch = r.ram === null || r.ram.addr === null ||
    deadStackBelow({ lo: STACK_FLOOR, hi: STACK_TOP }, floor)(r.ram.addr);
  console.log(`  CONTRACT: reached within ${REACH_FRAMES} frames; first byte ${show(r.ram)}`);
  assert.equal(onlyScratch, true, "the shared harness's FIRST differing byte is outside the stack scratch below the entry SP " +
    "(this arm checks reach; the arms below compare every cell)");
});

test("WRITE-SET: what the frozen routine moves, and where the scratch window is", { skip }, () => {
  const cells = new Set();
  const scratch = new Set();
  const seed = entryState();
  const sp = seed.regs.sp;
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const before = seed.clone();
    before.mem8[FLAG_CELL] = (i * 61) & 0xff;
    before.mem8[SIGNATURE_CELL] = (i * 37) & 0xff;
    before.mem8[SEQUENCE_SUBSTEP] = (i * 53) & 0xff;
    const after = before.clone();
    oracle(after);
    for (const d of allDiffs(before, after)) {
      if (inScratch(d.addr, sp)) scratch.add(d.addr);
      else cells.add(d.addr);
    }
  }
  const moved = [...cells].sort((p, q) => p - q);
  console.log(
    `  WRITE-SET (measured over ${CROSS_CHECK_POINTS} points): cells [${moved.map(hex4).join(" ")}]` +
      `; scratch [${[...scratch].sort((p, q) => p - q).map(hex4).join(" ")}] below ${hex4(sp)}`,
  );
  const strays = moved.filter((a) => !WRITTEN.includes(a));
  assert.deepEqual(strays.map(hex4), [], "the frozen routine writes a cell this file does not " +
    "restore between sweep points, so the sweep's machine reuse is unsound");
  assert.ok(moved.length > 0, "vacuous: the frozen routine moved no cell at all");
});

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  foldImageBlockIntoSignatureThenAdvanceSequence(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(
    `  EQUAL: seed byte ${e.mem8[SEED_BYTE]}, signature ${a.mem8[SIGNATURE_CELL]}, sp ${hex4(sp)}; ` +
      `${all.length} differing bytes, ${strays.length} outside the window`,
  );
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  for (const addr of WRITTEN) {
    assert.equal(a.mem8[addr], b.mem8[addr], `the cell at ${hex4(addr)} diverged`);
  }
});

test("NOT VACUOUS: a no-op FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.ok(WRITTEN.includes(d.addr), `the no-op is caught at ${hex4(d.addr)}, not a written cell`);
  console.log(`  NOT VACUOUS: the no-op is caught at ${hex4(d.addr)}`);
});

test("ENTRY REACH: dispatches per session, and what each entry arrives holding", { skip }, () => {
  const seen = sessions();
  const held = new Set(seen.flatMap((s) => [...s.held]));
  console.log(
    `  ENTRY REACH (measured over ${CORPUS_FRAMES} frames each): ${seen.map((s) =>
      `${s.label} ${s.dispatches}`).join(", ")}; arriving holding [${[...held].map(hex4).join(" ")}]`,
  );
  for (const s of seen) assert.equal(s.dispatches, DISPATCHES[s.label], `${s.label} count moved`);
  assert.ok(seen.some((s) => s.dispatches > 0), "vacuous: no session reaches the routine");
  assert.deepEqual([...held], [TARGET], "an entry arrived holding something other than this " +
    "routine's own address, so it is not only reached through the computed dispatch and the " +
    "live-out derivation in this file's header has to be redone");
});

test("CORPUS: every captured dispatch of four sessions is identical", { skip }, () => {
  const caught = corpusCaught(foldImageBlockIntoSignatureThenAdvanceSequence);
  const captured = sessions().map((s) => s.entries.length);
  console.log(`  CORPUS: ${captured.join("/")} captured dispatches, identical outside the window`);
  assert.deepEqual(caught, [0, 0, 0, 0], "the rewrite diverged on a real dispatch");
});

test("EXCLUDED, as a CEILING: no register outside the declared set moves", { skip }, () => {
  const moved = new Set();
  let points = 0;
  for (const k of BYTE_REGISTERS) {
    for (const v of [0, 1, 8, 127, 128, 255]) {
      const a = entryState().clone();
      a.regs[k] = v;
      const b = a.clone();
      oracle(a);
      foldImageBlockIntoSignatureThenAdvanceSequence(b);
      for (const q of REG_FIELDS) if (a.regs[q] !== b.regs[q]) moved.add(q);
      points++;
    }
  }
  const strays = REG_FIELDS.filter((k) => moved.has(k) && !EXCLUDED.includes(k));
  console.log(
    `  EXCLUDED (measured over ${points} points): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}` +
      `; ceiling ${EXCLUDED.join(", ")}`,
  );
  assert.deepEqual(strays, [], "a register outside the declared ceiling diverged");
});

test("DEAD STORE: the frozen routine's own constant store is overwritten before anything reads it", { skip }, () => {
  const left = new Set();
  for (let v = 0; v < VALUES; v++) {
    const m = entryState().clone();
    m.regs.c = v;
    oracle(m);
    left.add(m.regs.c);
  }
  console.log(`  DEAD STORE (frozen side only): ${VALUES} entry values leave [${[...left]}]`);
  assert.equal(left.size, 1, "the frozen routine's exit value depends on what it arrived with, so " +
    "the constant it stores is NOT dead and the rewrite may not drop it");
});

test("CELL SWEEP: all 256 prior values of each of the three written cells", { skip }, () => {
  assert.equal(cellSweepCaught(foldImageBlockIntoSignatureThenAdvanceSequence), 0, "the rewrite diverged at some prior cell value");
  console.log(`  CELL SWEEP: ${WRITTEN.length * VALUES} points, the written cells identical`);
});

test("REGISTER SWEEP: all 256 entry values of each byte register, and a pair cross", { skip }, () => {
  assert.equal(registerSweepCaught(foldImageBlockIntoSignatureThenAdvanceSequence), 0, "the rewrite diverged at some entry register");
  console.log(
    `  REGISTER SWEEP: ${BYTE_REGISTERS.length * VALUES + 25} points, the written cells identical`,
  );
});

test("THE REUSED MACHINES ARE SOUND: clone-per-point agrees on a sample", { skip }, () => {
  for (let i = 0; i < CROSS_CHECK_POINTS; i++) {
    const cells = [[FLAG_CELL, (i * 61) & 0xff], [SIGNATURE_CELL, (i * 37) & 0xff],
      [SEQUENCE_SUBSTEP, (i * 53) & 0xff]];
    const regs = [["c", (i * 29) & 0xff], ["b", (i * 17) & 0xff]];
    const m = entryState().clone();
    for (const [addr, v] of cells) m.mem8[addr] = v;
    for (const [k, v] of regs) m.regs[k] = v;
    assert.equal(unitDiff(foldImageBlockIntoSignatureThenAdvanceSequence, m), null, `clone-per-point diverged at point ${i}`);
    assert.equal(pointDiffers(foldImageBlockIntoSignatureThenAdvanceSequence, cells, regs), false,
      `the reused arena disagrees with clone-per-point at point ${i}`);
  }
  console.log(`  SOUND: ${CROSS_CHECK_POINTS} points agree between the arena and clone-per-point`);
});

test("WHOLE-MACHINE: an undriven session is byte-identical with the rewrite wired", { skip }, () => {
  const r = wholeRunCells(foldImageBlockIntoSignatureThenAdvanceSequence);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, WHOLE_FRAMES, `compared ${r.frames} of ${WHOLE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address`);
  }
  assert.deepEqual(r.cells.map(hex4), WHOLE_RUN_CELLS, "the set of dead stack bytes a whole run " +
    "leaves differing moved, so the exclusion is no longer measured");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, sweep, perSession, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of sweep points`, { skip }, () => {
    const caught = sweepCaught(twin);
    console.log(`  TEETH/${label}: caught on ${caught} of ${SWEEP_POINTS} sweep points`);
    assert.equal(caught, sweep, `the ${label} twin's sweep catch count moved`);
    assert.ok(caught > 0, `the sweep missed the ${label} twin everywhere`);
  });

  test(`TEETH: the ${label} twin's real-dispatch catch count, zeros recorded`, { skip }, () => {
    const caught = corpusCaught(twin);
    const blind = caught.every((n) => n === 0);
    console.log(
      `  TEETH/${label}: real sessions catch ${caught.join("/")}` +
        (blind ? " — caught by NO real dispatch, as recorded" : ""),
    );
    assert.deepEqual(caught, perSession, `the ${label} twin's real-dispatch counts moved`);
  });

  test(`TEETH: the whole machine sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || r.cells.some((c) => c < STACK_FLOOR || c >= STACK_TOP);
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-machine verdict on the ${label} twin changed`);
  });
}

test("THE SEED BYTE IS ZERO IN THIS IMAGE, which is why one twin below cannot be caught", { skip }, () => {
  const seed = entryState().mem8[SEED_BYTE];
  const neighbour = entryState().mem8[SEED_BYTE + 1];
  console.log(`  SEED: the byte the total starts from is ${seed}; its neighbour is ${neighbour}`);
  assert.equal(seed, 0, "the seed byte is no longer zero, so the unseeded twin is now catchable " +
    "and belongs among the teeth rather than among the recorded-invisible cases");
  assert.notEqual(neighbour, seed, "the neighbouring byte no longer differs, so the twin that " +
    "seeds from it proves nothing");
});

for (const [label, twin, why] of INVISIBLE_TWINS) {
  test(`TEETH: the ${label} twin is INVISIBLE, and the instruments are not`, { skip }, () => {
    const sweep = sweepCaught(twin);
    const corpus = corpusCaught(twin);
    const whole = wholeRunCells(twin);
    const strayCells = whole.cells.filter((c) => c < STACK_FLOOR || c >= STACK_TOP);
    console.log(
      `  TEETH/${label}: sweep ${sweep}, real sessions ${corpus.join("/")}, whole run ` +
        `${strayCells.length} cells outside the stack — invisible because ${why}`,
    );
    assert.equal(sweep, 0, `the ${label} twin moved a cell, so it is no longer the invisible case`);
    assert.deepEqual(corpus, [0, 0, 0, 0], `the ${label} twin was caught by a real dispatch`);
    assert.deepEqual(strayCells, [], `the ${label} twin forked the whole machine`);
    assert.equal(whole.threw, null, `the ${label} twin touched a live stack frame: ${whole.threw}`);
    // POSITIVE CONTROLS, same three instruments, same run: a twin that DOES move a cell is caught
    // by each of them. Without these the three zeros above would be indistinguishable from three
    // instruments that cannot detect anything.
    assert.ok(sweepCaught(brokenLengthShort) > 0, "the sweep is blind to everything");
    assert.ok(corpusCaught(brokenLengthShort).some((n) => n > 0), "the corpus is blind to everything");
    const control = wholeRunCells(brokenLengthShort);
    assert.ok(
      control.cells.some((c) => c < STACK_FLOOR || c >= STACK_TOP),
      "the whole run is blind to everything",
    );
  });
}
