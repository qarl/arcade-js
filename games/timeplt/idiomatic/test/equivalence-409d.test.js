// SPDX-License-Identifier: GPL-3.0-only
/**
 * clampOneShotCountdownThenRequestSound — memory-equivalent to the frozen oracle at ROM 0x409D.
 *
 * WHAT IT IS. One byte stamped into an object's record, then a transfer into the sound-request
 * shim at ROM 0x568E, WHICH IS ALREADY DECOMPILED — so the rewrite calls requestOneShotCountdownSound directly and
 * dissolving that transfer belongs to this caller's unit.
 *
 * ★ THE ORACLE MAKES A TEST WHOSE TWO ANSWERS GO TO THE SAME PLACE. Between the stamp and the
 *   transfer it loads the era cell and tests it, and both the conditional and the unconditional
 *   jump that follows name the same target, so nothing downstream can depend on the answer. The
 *   rewrite therefore does not make the test at all, and THE TEST IS A NO-OP asserts the licence
 *   on the ORACLE rather than assuming it: the era cell is swept over all 256 values and every
 *   outcome the frozen side produces is compared against the first.
 *
 * ★ THIS ENTRY IS NOT REACHED BY THE SHARED TAPE. It needs a longer driven one that fires and
 *   steers, and even then it is dispatched ONCE in two thousand frames. The first arm asserts both
 *   facts so "we used a different tape" cannot quietly become "we never reached it", and the
 *   crafted arms — not the corpus — are what hold this file.
 *
 * ★ THE ORACLE PUSHES AND THE REWRITE DOES NOT, so the bytes just below the entry stack pointer
 *   are dead scratch on one side only. The window is MEASURED and pinned, and every arm walks the
 *   whole dump so the exclusion cannot quietly widen.
 *
 * LIVE-OUT, DERIVED FROM THE ORACLE. Two call sites reach this entry. One follows it with a
 *   decrement of the same record byte, which reads memory and writes the flags; the other follows
 *   it with a call whose first two instructions load the high and low halves of a pair from
 *   memory and whose next writes the flags. Neither reads the accumulator, the flags or any pair
 *   this entry could have left, so the live-out is MEMORY: the stamped byte and whatever the
 *   sound request leaves in the queue.
 *
 * GATE: crafted-entry, because one real dispatch is not a corpus. Holes stated:
 *
 *   1. REACHED, and only by the longer tape — both asserted, and the frame pinned.
 *   2. EQUAL at the real dispatch — identical outside the scratch window.
 *   3. NOT VACUOUS — a no-op FAILS the same masked diff, on a real cell.
 *   4. THE TEST IS A NO-OP — the era cell swept over the ORACLE, all 256 values agreeing outside
 *      the dead scratch. The era value DOES reach that scratch, in the flags byte the request
 *      body parks, and the arm counts how often rather than masking the fact away.
 *   5. EXCLUDED — the registers that move over the whole cross, pinned by measurement.
 *  5b. CALLS, NOT RESTATES — the module's text, with the shim's own body as a control.
 *   6. THE STAMP — the byte read back out of the record, over several record bases.
 *   7. THE SOUND — the code appended to the queue, read back rather than asserted about.
 *   8. GATE CROSS — permission, queue length, era and prior record byte crossed.
 *   9. EXHAUSTIVE — all 256 prior values of the record byte.
 *  10. WHOLE-MACHINE — the driven session with the rewrite wired, diffed every frame. With one
 *      dispatch in the run this arm is an equality check, not a discriminator, and the per-twin
 *      verdicts below say which twins it can and cannot see.
 *  11. TEETH — eight twins, each with an exact catch count over the cross. Two are invisible to
 *      the whole run — with one dispatch, in the first era, under permission already set, neither
 *      the era-gated twin nor the ungated one changes anything the run samples — and their
 *      verdicts record that rather than glossing it.
 *
 * HOLE: WHAT the sound is. Nothing on this processor can say; the code is a byte handed to a
 * second one. This gate fixes that the request is made and under what permission.
 * HOLE: the record bases are the real one and two neighbours, not a sweep of the record table.
 *
 * Run: node --test games/timeplt/idiomatic/test/equivalence-409d.test.js
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { makeMachine, COIN_FRAME, START_FRAME, ENTRY_FRAMES, romsPresent } from "./_harness.js";
import { clampOneShotCountdownThenRequestSound } from "../clampOneShotCountdownThenRequestSound.js";
import { requestOneShotCountdownSound } from "../requestOneShotCountdownSound.js";
import { ERA_INDEX, PLAY_ACTIVE } from "../names.js";
import { loc_409d as oracle } from "../../translated/loc_409d.js";
import { REG_FIELDS } from "../../../../core/cpu/z80.js";
import { liveStackDiffs, recordFrameFloors } from "./_frameFloor.js";

const TARGET = 0x409d;

const STATE = 0;
const STAMPED_STATE = 59;
const QUEUE_LENGTH = 0xac43;

/** Measured: the oracle's transfer bracket and what the request body parks under it. */
const SCRATCH_BYTES = 4;

const MOVED = ["a", "f", "sp"];

/** The longer tape, its length, and the frame this entry is first reached on it. Measured. */
const TAPE_FRAMES = 2000;
const FIRST_DISPATCH = 1899;
const DISPATCHES = 1;

const RET_TSTATES = 10;

const IN0 = 0xc300;
const IN1 = 0xc320;
const HOLD = 8;
const TURN_HOLD = 60;
const TURN_FIRST_FRAME = 640;

const skip = romsPresent() ? false : "ROM images are not assembled";

const hex4 = (v) => "0x" + (v & 0xffff).toString(16).padStart(4, "0");
const show = (d) => (d ? `${hex4(d.addr ?? 0)}: oracle=${d.a} candidate=${d.b}` : "identical");
const everyByte = Array.from({ length: 256 }, (_unused, v) => v);

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");

/**
 * The module's own text against the shim it is supposed to CALL. The shim is identified by a
 * constant out of its own body; the module must name its file, call it, and NOT carry that
 * constant. The same predicate is run over the shim itself as a positive control, so an absence
 * is only evidence once the check is shown able to see the thing present.
 */
const HELPERS = [["requestOneShotCountdownSound", "../requestOneShotCountdownSound.js", "0x2d87"]];

function callsRatherThanRestates(text, [name, file, ownConstant]) {
  return text.includes(`from "./${file.slice(3)}"`) &&
    text.includes(`${name}(m)`) &&
    !text.includes(ownConstant);
}

/** Coin, start, then the trigger held while the stick walks round the compass. */
function drivenTape() {
  const tape = [
    { frame: COIN_FRAME, port: IN0, bits: 0x01, dur: HOLD },
    { frame: START_FRAME, port: IN0, bits: 0x08, dur: HOLD },
    { frame: TURN_FIRST_FRAME - HOLD, port: IN1, bits: 0x10, dur: TAPE_FRAMES },
  ];
  const compass = [0x01, 0x05, 0x04, 0x06, 0x02, 0x0a, 0x08, 0x09, 0x01, 0x04, 0x02, 0x08];
  let frame = TURN_FIRST_FRAME;
  for (let step = 0; step < 40; step++) {
    tape.push({ frame, port: IN1, bits: compass[step % compass.length], dur: TURN_HOLD });
    frame += TURN_HOLD;
  }
  return tape;
}

const drivenMachine = (overrides) => makeMachine(overrides, { tape: drivenTape() });

// ── the entry, and the masked comparison ────────────────────────────────────────────────

let captured = null;
let firstFrame = null;
let dispatchCount = 0;

function capture() {
  if (captured !== null) return captured;
  const m = drivenMachine(
    new Map([[TARGET, (mm) => {
      dispatchCount++;
      if (captured === null) {
        captured = mm.clone();
        firstFrame = mm.frames.length;
      }
      return oracle(mm);
    }]]),
  );
  m.runFrames(TAPE_FRAMES);
  assert.equal(m.stoppedBy, null, `session stopped early: ${m.stoppedBy}`);
  return captured;
}

function entryState() {
  const e = capture();
  assert.notEqual(e, null, "vacuous: even the longer tape never reached the routine");
  return e;
}

function allDiffs(a, b) {
  const da = a.dumpState();
  const db = b.dumpState();
  const out = [];
  for (let i = 0; i < da.length; i++) {
    if (da[i] !== db[i]) out.push({ addr: a.stateOffsetToAddr(i), a: da[i], b: db[i] });
  }
  return out;
}

function inScratch(addr, sp) {
  return addr !== null && addr >= sp - SCRATCH_BYTES && addr < sp;
}

/** Oracle vs candidate on clones: masked RAM, then every register outside the excluded set. */
function unitDiff(candidate, machine) {
  const sp = machine.regs.sp;
  const a = machine.clone();
  const b = machine.clone();
  oracle(a);
  candidate(b);
  const ram = allDiffs(a, b).find((d) => !inScratch(d.addr, sp));
  if (ram) return ram;
  for (const k of REG_FIELDS) {
    if (MOVED.includes(k)) continue;
    if (a.regs[k] !== b.regs[k]) return { addr: null, a: a.regs[k], b: b.regs[k] };
  }
  return null;
}

/** A real captured machine with the record base, its prior byte, the era, the permission and
 *  the queue length forced. */
function craft(base, prior, era, play, length) {
  const m = entryState().clone();
  m.regs.ix = base;
  m.mem8[base + STATE] = prior;
  m.mem8[ERA_INDEX] = era;
  m.mem8[PLAY_ACTIVE] = play;
  m.mem8[QUEUE_LENGTH] = length;
  return m;
}

const RECORD_STEP = 0x10;
function bases() {
  const real = entryState().regs.ix;
  return [real, real + RECORD_STEP, real - RECORD_STEP];
}
const ERAS = [0, 1, 7];
const PLAYS = [0x00, 0xff];
const LENGTHS = [0, 2, 255];
const PRIORS = [0, 1, STAMPED_STATE, 0xf0, 0xff];

let crossCache = null;
function cross() {
  if (crossCache) return crossCache;
  const out = [];
  for (const base of bases()) {
    for (const prior of PRIORS) {
      for (const era of ERAS) {
        for (const play of PLAYS) for (const length of LENGTHS) out.push([base, prior, era, play, length]);
      }
    }
  }
  crossCache = out;
  return out;
}

// ── the cycle shim and the whole run ────────────────────────────────────────────────────

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
    const base = drivenMachine();
    const frames = base.runFrames(TAPE_FRAMES);
    baselineRun = { frames, offsetToAddr: (o) => base.stateOffsetToAddr(o) };
  }
  return baselineRun;
}

function wholeRunCells(candidate) {
  const base = baseline();
  let fired = 0;
  const host = drivenMachine(new Map([[TARGET, (mm) => (fired++, hosted(candidate)(mm))]]));
  let hostFrames = [];
  let threw = null;
  const floors = recordFrameFloors(host);
  try {
    hostFrames = host.runFrames(TAPE_FRAMES);
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
  return { cells: [...cells].sort((a, b) => a - b), frames: n, fired, threw };
}

/** Measured with the correct rewrite wired over the driven run. */
const STACK_FLOOR = 0xafd0;
const STACK_TOP = 0xb000;
const WHOLE_RUN_CELLS = [0xafdc, 0xafdd, 0xafde, 0xafdf];

const sameCells = (cells) =>
  cells.length === WHOLE_RUN_CELLS.length && cells.every((c, i) => c === WHOLE_RUN_CELLS[i]);

// ── the twins ───────────────────────────────────────────────────────────────────────────

function brokenNoOp() {}

/** BUG: the record is stamped and no sound is asked for. */
function brokenStampOnly(m) {
  m.mem8[m.regs.ix + STATE] = STAMPED_STATE;
}

/** BUG: the sound is asked for and the record is left alone. */
function brokenSoundOnly(m) {
  requestOneShotCountdownSound(m);
}

/** BUG: the stamped value is one short. */
function brokenValueOffByOne(m) {
  m.mem8[m.regs.ix + STATE] = STAMPED_STATE - 1;
  requestOneShotCountdownSound(m);
}

/** BUG: the stamp lands on the record's second byte. */
function brokenOffsetOffByOne(m) {
  m.mem8[m.regs.ix + STATE + 1] = STAMPED_STATE;
  requestOneShotCountdownSound(m);
}

/** BUG: the request is made twice. */
function brokenSoundTwice(m) {
  m.mem8[m.regs.ix + STATE] = STAMPED_STATE;
  requestOneShotCountdownSound(m);
  requestOneShotCountdownSound(m);
}

/** BUG: the era test is treated as live, so the stamp only happens in the first era. */
function brokenEraGated(m) {
  if (m.mem8[ERA_INDEX] === 0) m.mem8[m.regs.ix + STATE] = STAMPED_STATE;
  requestOneShotCountdownSound(m);
}

/** BUG: the request bypasses the permission cell that normally drops it. */
function brokenUngated(m) {
  m.mem8[m.regs.ix + STATE] = STAMPED_STATE;
  const was = m.mem8[PLAY_ACTIVE];
  m.mem8[PLAY_ACTIVE] = 0xff;
  requestOneShotCountdownSound(m);
  m.mem8[PLAY_ACTIVE] = was;
}

const TWINS = [
  ["no-op", brokenNoOp, 243, true],
  ["stamp-only", brokenStampOnly, 135, true],
  ["sound-only", brokenSoundOnly, 216, true],
  ["value-off-by-one", brokenValueOffByOne, 270, true],
  ["offset-off-by-one", brokenOffsetOffByOne, 270, true],
  ["sound-twice", brokenSoundTwice, 135, true],
  ["era-gated", brokenEraGated, 144, false],
  ["ungated", brokenUngated, 135, false],
];

// ── the gate ────────────────────────────────────────────────────────────────────────────

test("REACHED, and only by the longer tape", { skip }, () => {
  const e = entryState();
  assert.equal(dispatchCount, DISPATCHES, "the dispatch count on the longer tape moved");
  assert.equal(firstFrame, FIRST_DISPATCH, "the frame it is first reached on moved");
  let onShared = 0;
  const shared = makeMachine(new Map([[TARGET, (mm) => (onShared++, oracle(mm))]]));
  shared.runFrames(ENTRY_FRAMES);
  assert.equal(onShared, 0, "the shared tape now reaches it, so this gate should use that instead");
  console.log(
    `  REACHED: ${dispatchCount} dispatch at frame ${firstFrame} on the longer tape, ${onShared} on ` +
      `the shared one; record ${hex4(e.regs.ix)} holding ${e.mem8[e.regs.ix]}, era ` +
      `${e.mem8[ERA_INDEX]}, permission ${e.mem8[PLAY_ACTIVE]}, sp ${hex4(e.regs.sp)}`,
  );
});

test("EQUAL at the real dispatch: identical outside the scratch window", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  const a = e.clone();
  const b = e.clone();
  oracle(a);
  clampOneShotCountdownThenRequestSound(b);
  const all = allDiffs(a, b);
  const strays = all.filter((d) => !inScratch(d.addr, sp));
  console.log(`  EQUAL: ${all.length} differing bytes, ${strays.length} outside [SP-${SCRATCH_BYTES}, SP)`);
  assert.deepEqual(strays, [], `a divergence escaped the scratch window: ${show(strays[0])}`);
  assert.ok(all.length <= SCRATCH_BYTES, "more bytes differ than the window is wide");
});

test("NOT VACUOUS: a no-op candidate FAILS the same masked diff, on a real cell", { skip }, () => {
  const d = unitDiff(brokenNoOp, entryState());
  assert.notEqual(d, null, "the masked diff passed a candidate that does nothing");
  assert.notEqual(d.addr, null, "the no-op must be caught on a cell, not on a register alone");
  console.log(`  NOT VACUOUS: the empty candidate is caught — ${show(d)}`);
});

test("THE TEST IS A NO-OP: the era cell swept, on the frozen side", { skip }, () => {
  const e = entryState();
  const sp = e.regs.sp;
  let reference = null;
  let reachedScratch = 0;
  for (const era of everyByte) {
    const s = e.clone();
    s.mem8[ERA_INDEX] = era;
    oracle(s);
    s.mem8[ERA_INDEX] = e.mem8[ERA_INDEX];
    if (reference === null) {
      reference = s;
      continue;
    }
    const d = allDiffs(reference, s);
    assert.deepEqual(d.filter((z) => !inScratch(z.addr, sp)), [], `the frozen side behaves ` +
      `differently at era ${era}, outside the dead scratch`);
    if (d.length) reachedScratch++;
  }
  assert.ok(reachedScratch > 0, "no era value reaches even the dead scratch, so this sweep may be " +
    "poking a cell the frozen side never reads");
  console.log(`  THE TEST IS A NO-OP: 256 era values, one outcome; ${reachedScratch} of them show ` +
    "up in the dead scratch alone");
});

test("EXCLUDED, deliberately: only scratch registers move, over the whole cross", { skip }, () => {
  const moved = new Set();
  for (const entry of cross()) {
    const a = craft(...entry);
    const b = a.clone();
    oracle(a);
    clampOneShotCountdownThenRequestSound(b);
    for (const k of REG_FIELDS) if (a.regs[k] !== b.regs[k]) moved.add(k);
  }
  console.log(`  EXCLUDED (measured): ${REG_FIELDS.filter((k) => moved.has(k)).join(", ")}`);
  // MOVED is a CEILING, not a set the rewrite is required to fill. deepEqual against it
  // would demand the divergence and go RED on a rewrite that became register-exact.
  assert.deepEqual(REG_FIELDS.filter((k) => moved.has(k) && !MOVED.includes(k)), [],
    "a register outside the declared cap diverged");
});

test("CALLS, NOT RESTATES: the module's text, with the shim as a positive control", () => {
  const module = read("../clampOneShotCountdownThenRequestSound.js");
  for (const helper of HELPERS) {
    assert.ok(callsRatherThanRestates(module, helper), `the module does not call ${helper[0]}`);
    assert.ok(!callsRatherThanRestates(read(helper[1]), helper), `the check passes ${helper[0]}'s ` +
      "OWN body, so it cannot tell a call from an inlined copy and proves nothing");
  }
  console.log("  CALLS, NOT RESTATES: the request shim is called, and its own body fails the " +
    "same check");
});

test("THE STAMP: the byte read back out of the record, on several bases", { skip }, () => {
  for (const base of bases()) {
    for (const prior of PRIORS) {
      const a = craft(base, prior, 0, 0xff, 2);
      const b = a.clone();
      oracle(a);
      clampOneShotCountdownThenRequestSound(b);
      assert.equal(a.mem8[base + STATE], STAMPED_STATE, `the frozen side left ${a.mem8[base]}`);
      assert.equal(b.mem8[base + STATE], a.mem8[base + STATE], `record ${hex4(base)} prior ${prior}`);
    }
  }
  console.log(`  THE STAMP: ${bases().length * PRIORS.length} record/prior pairs both stamped ` +
    `${STAMPED_STATE}`);
});

test("THE SOUND: the code appended to the queue, read back", { skip }, () => {
  const a = craft(entryState().regs.ix, 0xf0, 0, 0xff, 2);
  const b = a.clone();
  oracle(a);
  clampOneShotCountdownThenRequestSound(b);
  assert.equal(a.mem8[QUEUE_LENGTH], 3, "the frozen side appended nothing under permission");
  assert.equal(b.mem8[QUEUE_LENGTH], a.mem8[QUEUE_LENGTH], "the rewrite appended a different count");
  assert.equal(b.mem8[QUEUE_LENGTH + 3], a.mem8[QUEUE_LENGTH + 3], "a different code was appended");
  const dropped = craft(entryState().regs.ix, 0xf0, 0, 0x00, 2);
  oracle(dropped);
  assert.equal(dropped.mem8[QUEUE_LENGTH], 2, "the cleared permission no longer drops the request");
  console.log(`  THE SOUND: both sides append ${a.mem8[QUEUE_LENGTH + 3]}, and a cleared ` +
    "permission drops it");
});

test("GATE CROSS: era, permission, queue length and prior byte crossed", { skip }, () => {
  for (const entry of cross()) {
    const d = unitDiff(clampOneShotCountdownThenRequestSound, craft(...entry));
    assert.equal(d, null, `base ${hex4(entry[0])} prior ${entry[1]} era ${entry[2]} play ${entry[3]} ` +
      `length ${entry[4]}: ${show(d)}`);
  }
  console.log(`  GATE CROSS: ${cross().length} combinations identical`);
});

test("EXHAUSTIVE: all 256 prior values of the record byte", { skip }, () => {
  const base = entryState().regs.ix;
  for (const prior of everyByte) {
    const d = unitDiff(clampOneShotCountdownThenRequestSound, craft(base, prior, 0, 0xff, 2));
    assert.equal(d, null, `prior ${prior}: ${show(d)}`);
  }
  console.log("  EXHAUSTIVE: 256 prior record bytes identical");
});

test("WHOLE-MACHINE: the driven session differs only in stack scratch", { skip }, () => {
  const r = wholeRunCells(clampOneShotCountdownThenRequestSound);
  console.log(
    `  WHOLE-MACHINE: ${r.frames} frames, ${r.fired} dispatches, differing cells ` +
      `[${r.cells.map(hex4).join(" ")}]`,
  );
  assert.equal(r.threw, null, `the run threw: ${r.threw}`);
  assert.equal(r.frames, TAPE_FRAMES, `compared ${r.frames} of ${TAPE_FRAMES} frames`);
  assert.ok(r.fired > 0, "vacuous: the override never dispatched");
  for (const cell of r.cells) {
    assert.ok(cell >= STACK_FLOOR && cell < STACK_TOP, `${hex4(cell)} is not a stack address, so a ` +
      "real game cell diverged over the run");
  }
  assert.deepEqual(r.cells, WHOLE_RUN_CELLS, "the set of dead stack bytes a whole run leaves " +
    "differing moved, so the exclusion is no longer measured");
});

// ── teeth ───────────────────────────────────────────────────────────────────────────────

for (const [label, twin, crossCaught, wholeRunSees] of TWINS) {
  test(`TEETH: the ${label} twin is caught on an exact count of crafted entries`, { skip }, () => {
    const caught = cross().filter((e) => unitDiff(twin, craft(...e)) !== null).length;
    console.log(`  TEETH/${label}: caught on ${caught} of ${cross().length} crafted entries`);
    assert.equal(caught, crossCaught, `the ${label} twin's crafted catch count moved`);
    assert.ok(caught > 0, `the crafted cross missed the ${label} twin everywhere`);
  });

  test(`TEETH: the whole run sees the ${label} twin, or is recorded blind`, { skip }, () => {
    const r = wholeRunCells(twin);
    const seen = r.threw !== null || !sameCells(r.cells);
    console.log(`  TEETH/${label}: whole run ${seen ? "catches it" : "is BLIND, as recorded"}`);
    assert.ok(r.fired > 0, "vacuous: the twin never dispatched");
    assert.equal(seen, wholeRunSees, `the whole-run verdict on the ${label} twin changed`);
  });
}
