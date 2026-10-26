// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_271e (ROM 0x271E) — the thin wrapper that delegates to
 * the vertical-reposition machine dispatchElevatorRideByColumn and returns.
 *
 * loc_271e reads and writes NOTHING of its own: its whole memory-observable
 * behaviour is dispatchElevatorRideByColumn's, decided by the same four bytes dispatchElevatorRideByColumn reads
 * (EDGE_REPOSITION_FLAG, MARIO_AIRBORNE, MARIO_X, MARIO_Y) and produced by the
 * same dispatched arms (loc_2766 reset / carryMarioUpWithLift down-mover / carryMarioDownWithLift up-mover).
 *
 * The oracle brackets the delegation as `push16(0x2721); call 0x2745; ret`, so on
 * EVERY path it WRITES the pushed return address 0x2721 into the stack scratch
 * (0x6bfc/0x6bfd, inside STACK_SCRATCH) and nets exactly one caller-return pop. The
 * idiomatic routine models no stack (a direct dispatchElevatorRideByColumn call + a plain JS return),
 * so runPair performs ONE m.ret() after the candidate to line pc + SP up, and the
 * RAM diff EXCLUDES the dead STACK_SCRATCH the oracle's push churns (mirroring
 * equivalence-0350) — every live work-RAM cell is still compared.
 *
 * 0x271E is NEVER dispatched in attract (it rides sub_26fa's 0x197A gameplay
 * cascade, gated off in coin_start/attract; its unconditional callee 0x2745 is 0
 * over 6000 frames), so crafted entries on a REAL booted attract base carry the
 * gate.
 *
 *   0. REACHABILITY — confirm 0x271E stays unreached in attract, so crafted
 *      coverage carries the gate (if it ever fires, add captured coverage).
 *   1. EQUAL (crafted, exhaustive dispatch) — loc_271e == oracle over RAM −
 *      STACK_SCRATCH + pc + SP across ALL 256 MARIO_X values (every band boundary)
 *      crossed with a MARIO_Y set that drives both sub-arms of each mover, active
 *      path. PLUS the two guard early-outs (flag clear; airborne set) — each must
 *      match AND write no live RAM.
 *   2. NON-VACUITY + BOUNDED EXCLUSION — each band writes its arm's exact live
 *      cells THROUGH the wrapper (reset -> {EDGE, START_FALL}, mover step ->
 *      {MARIO_Y, sprite-Y}, mover handoff -> {MARIO_ACTIVE, EDGE}), so the sweep
 *      compares real overwrites; and the ONLY whole-dump diff between the oracle
 *      and the stack-free candidate lands inside STACK_SCRATCH, so the exclusion
 *      hides nothing live.
 *   3. TEETH — two deliberately-broken twins the same sweep MUST catch:
 *        (a) a dropped delegation (empty wrapper) — the arm's writes go missing.
 *        (b) a wrong delegation (always the reset arm) — the mover bands diverge.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-271e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_271e as oracle } from "../../translated/loc_271e.js";
import { loc_271e } from "../loc_271e.js";
import { loc_2766 } from "../loc_2766.js"; // idiomatic reset arm, used by the wrong-delegate twin
import {
  STACK_SCRATCH,
  EDGE_REPOSITION_FLAG,
  MARIO_AIRBORNE,
  MARIO_X,
  MARIO_Y,
  MARIO_ACTIVE,
  MARIO_START_FALL,
  MARIO_SPRITE_RECORD,
  SPRITE_Y,
} from "../names.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x271e;
const SPRITE_Y_CELL = MARIO_SPRITE_RECORD + SPRITE_Y; // 0x694F — Mario's sprite-record Y

// sub_271e is reached by a tail-jump from sub_26fa, whose own caller is `call 0x26FA`
// at ROM 0x19A7, so the return address on the stack when 0x271E runs is 0x19AA.
const RET_ADDR = 0x19aa;

// MARIO_Y priors that drive BOTH sub-arms of each mover (same set dispatchElevatorRideByColumn needs):
// carryMarioUpWithLift steps for Y >= 0x71 (else hands off); carryMarioDownWithLift steps for Y < 0xE8 (else
// hands off). This set hits each mover's step AND handoff arm.
const Y_SET = [0x00, 0x70, 0x71, 0x80, 0xe7, 0xe8, 0xff];

// Observable priors so every arm's writes are REAL overwrites (never no-ops), plus
// neighbour noise to catch an off-by-one write target.
const ACTIVE_PRIOR = 0xa5;       // MARIO_ACTIVE prior; the handoff reset clears it to 0
const START_FALL_PRIOR = 0x00;   // MARIO_START_FALL prior; the reset arm sets it to 1
const MIRROR_PRIOR = 0x00;       // sprite-Y prior; a mover step writes >= 0x70 here, never 0
const NOISE = new Map([
  [MARIO_Y - 1, 0x11], [MARIO_Y + 1, 0x22],             // 0x6204 / 0x6206
  [SPRITE_Y_CELL - 1, 0x33], [SPRITE_Y_CELL + 1, 0x44], // 0x694E / 0x6950
]);

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First RAM byte that differs between two machines, SKIPPING the dead STACK_SCRATCH
// region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). { addr, a, b } | null.
function firstRamDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// Every NON-STACK RAM address that changed between two machines (the oracle's push
// churn in STACK_SCRATCH is excluded, so this is a genuine live-write set).
function changedAddrs(pre, post, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = pre.dumpState(), db = post.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = pre.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out.sort((p, q) => p - q);
}
const sortAddrs = (a) => a.slice().sort((p, q) => p - q);

// A real, self-consistent machine: boot + a stretch of attract so work RAM holds
// realistic values. 0x271E is never dispatched here; every entry is crafted by poking.
function attractBase(frames = 180) {
  const m = new Machine(ROM);
  m.runFrames(frames);
  return m.clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * A crafted 0x271E entry: a clone of `base` with the two guard inputs, MARIO_X,
 * MARIO_Y, the arms' target cells seeded to observable priors, neighbour noise, and
 * a stack carrying a plausible caller return so the terminal pop is well-defined.
 */
function makeEntry(base, x, y, { flag = 0x01, airborne = 0x00 } = {}) {
  const e = base.clone();
  e.mem.write8(EDGE_REPOSITION_FLAG, flag);
  e.mem.write8(MARIO_AIRBORNE, airborne);
  e.mem.write8(MARIO_X, x);
  e.mem.write8(MARIO_Y, y);
  e.mem.write8(MARIO_ACTIVE, ACTIVE_PRIOR);
  e.mem.write8(MARIO_START_FALL, START_FALL_PRIOR);
  e.mem.write8(SPRITE_Y_CELL, MIRROR_PRIOR);
  for (const [addr, val] of NOISE) e.mem.write8(addr, val);
  e.regs.sp = 0x6c00;
  e.push16(RET_ADDR);
  e.nextNmi = Infinity;
  e.nextBoundary = Infinity;
  return e;
}

/** The memory-equivalence contract: RAM − the stack scratch below the entry SP + pc + SP. Live-out is
 *  memory-only; pc/SP are asserted only to prove the dissolved call/ret bracket
 *  lines up. Returns { kind, addr?, msg } | null. */
function contractDiff(a, b, liveFloor) {
  const ram = firstRamDiff(a, b, liveFloor);
  if (ram) return { kind: "RAM", addr: ram.addr, msg: `RAM@${hx(ram.addr ?? 0)} oracle=${ram.a} cand=${ram.b}` };
  if (a.pc !== b.pc) return { kind: "pc", msg: `pc oracle=${hx(a.pc)} cand=${hx(b.pc)}` };
  if (a.regs.sp !== b.regs.sp) return { kind: "SP", msg: `SP oracle=${hx(a.regs.sp)} cand=${hx(b.regs.sp)}` };
  return null;
}

/**
 * Run the oracle and a candidate on two FRESH, byte-identical crafted entries and
 * diff the contract. The oracle performs its own push16/call/ret bracket; the
 * candidate models no stack, so one m.ret() after it lines pc + SP up. Returns the
 * diff (or null).
 */
function runPair(base, x, y, opts, candidate) {
  const a = makeEntry(base, x, y, opts); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, x, y, opts); // candidate
  oracle(a);
  candidate(b);
  b.ret(); // model the candidate's terminal return (the oracle's `ret` at 0x2721)
  return contractDiff(a, b, aFloor);
}

/** Sweep all 256 MARIO_X values crossed with Y_SET, active path. First mismatch + count. */
function fullSweep(base, candidate) {
  let count = 0;
  for (let x = 0; x < 256; x++) {
    for (const y of Y_SET) {
      const diff = runPair(base, x, y, {}, candidate);
      count++;
      if (diff) return { mismatch: { x, y, diff }, count };
    }
  }
  return { mismatch: null, count };
}

const describeMismatch = (mm) => mm && `at MARIO_X=${hx(mm.x)} MARIO_Y=${hx(mm.y)}: ${mm.diff.msg}`;

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x271E is NOT dispatched in attract — the gate rests on crafted entries", () => {
  let count = 0;
  const snap = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);
  assert.equal(count, 0, "expected 0x271E to stay unreached in attract; if it now fires, add captured coverage");
  console.log(`  REACHABILITY: ${count} natural 0x271E dispatches in 6000 frames — crafted coverage carries the gate`);
});

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): loc_271e == oracle across all 256 MARIO_X x Y_SET (active), RAM − stack + pc + SP", () => {
  const base = attractBase();
  const { mismatch, count } = fullSweep(base, loc_271e);
  assert.equal(mismatch, null, describeMismatch(mismatch));
  assert.equal(count, 256 * Y_SET.length, "must have swept the full MARIO_X x Y_SET grid");
  console.log(`  EQUAL/dispatch: ${count} (MARIO_X, MARIO_Y) combos — RAM − stack + pc + SP identical to the oracle`);
});

test("EQUAL (crafted): both guard early-outs match the oracle AND write no live RAM", () => {
  const base = attractBase();

  // Flag clear -> dispatchElevatorRideByColumn's first guard returns; nothing is repositioned.
  for (const y of Y_SET) {
    for (const x of [0x00, 0x30, 0x50, 0x70, 0x90]) {
      const diff = runPair(base, x, y, { flag: 0x00 }, loc_271e);
      assert.equal(diff, null, `flag-clear guard diverged at MARIO_X=${hx(x)} MARIO_Y=${hx(y)}: ${diff && diff.msg}`);
    }
  }
  // Airborne set -> dispatchElevatorRideByColumn's second guard returns; the reposition waits for a grounded frame.
  for (const y of Y_SET) {
    for (const x of [0x00, 0x30, 0x50, 0x70, 0x90]) {
      const diff = runPair(base, x, y, { flag: 0x01, airborne: 0x01 }, loc_271e);
      assert.equal(diff, null, `airborne guard diverged at MARIO_X=${hx(x)} MARIO_Y=${hx(y)}: ${diff && diff.msg}`);
    }
  }

  // And the guard paths write NO LIVE RAM (the only oracle write is the dead push).
  const flagClear = makeEntry(base, 0x30, 0x80, { flag: 0x00 });
  const flagClearPost = flagClear.clone(); oracle(flagClearPost);
  assert.deepEqual(changedAddrs(flagClear, flagClearPost, flagClear.regs.sp), [], "flag-clear guard wrote live RAM — should be a pure early return");

  const airborne = makeEntry(base, 0x30, 0x80, { flag: 0x01, airborne: 0x01 });
  const airbornePost = airborne.clone(); oracle(airbornePost);
  assert.deepEqual(changedAddrs(airborne, airbornePost, airborne.regs.sp), [], "airborne guard wrote live RAM — should be a pure early return");

  console.log("  EQUAL/guards: flag-clear and airborne early-outs identical to the oracle and write no live RAM");
});

// -- 2. NON-VACUITY + BOUNDED EXCLUSION ---------------------------------------

test("NON-VACUITY: each band writes exactly its arm's live cells THROUGH the wrapper", () => {
  const base = attractBase();

  // RESET band (X=0x10, below the first mover band): loc_2766 sets START_FALL, clears EDGE.
  const reset = makeEntry(base, 0x10, 0x80);
  const resetPost = reset.clone(); oracle(resetPost);
  assert.equal(resetPost.mem.read8(MARIO_START_FALL), 1, "reset arm must set MARIO_START_FALL");
  assert.equal(resetPost.mem.read8(EDGE_REPOSITION_FLAG), 0, "reset arm must clear EDGE_REPOSITION_FLAG");
  assert.deepEqual(changedAddrs(reset, resetPost, reset.regs.sp), sortAddrs([EDGE_REPOSITION_FLAG, MARIO_START_FALL]),
    "reset band live-write set must be exactly {EDGE_REPOSITION_FLAG, MARIO_START_FALL}");

  // MOVER-STEP band (X=0x30 -> carryMarioUpWithLift, Y=0x80 step): decrement MARIO_Y and mirror it.
  const step = makeEntry(base, 0x30, 0x80);
  const stepPost = step.clone(); oracle(stepPost);
  assert.equal(stepPost.mem.read8(MARIO_Y), 0x7f, "mover step must decrement MARIO_Y");
  assert.equal(stepPost.mem.read8(SPRITE_Y_CELL), 0x7f, "mover step must mirror MARIO_Y to the sprite record");
  assert.deepEqual(changedAddrs(step, stepPost, step.regs.sp), sortAddrs([MARIO_Y, SPRITE_Y_CELL]),
    "mover-step live-write set must be exactly {MARIO_Y, sprite-Y}");
  for (const [addr, val] of NOISE) assert.equal(stepPost.mem.read8(addr), val, `step: neighbour ${hx(addr)} disturbed`);

  // MOVER-HANDOFF band (X=0x30 -> carryMarioUpWithLift, Y=0x00 handoff): clear ACTIVE + EDGE.
  const handoff = makeEntry(base, 0x30, 0x00);
  const handoffPost = handoff.clone(); oracle(handoffPost);
  assert.equal(handoffPost.mem.read8(MARIO_ACTIVE), 0, "mover handoff must clear MARIO_ACTIVE");
  assert.equal(handoffPost.mem.read8(EDGE_REPOSITION_FLAG), 0, "mover handoff must clear EDGE_REPOSITION_FLAG");
  assert.deepEqual(changedAddrs(handoff, handoffPost, handoff.regs.sp), sortAddrs([MARIO_ACTIVE, EDGE_REPOSITION_FLAG]),
    "mover-handoff live-write set must be exactly {MARIO_ACTIVE, EDGE_REPOSITION_FLAG}");

  // UP-MOVER band (X=0x70 -> carryMarioDownWithLift, Y=0x80 step): increment MARIO_Y and mirror.
  const upStep = makeEntry(base, 0x70, 0x80);
  const upStepPost = upStep.clone(); oracle(upStepPost);
  assert.equal(upStepPost.mem.read8(MARIO_Y), 0x81, "up-mover step must increment MARIO_Y");
  assert.deepEqual(changedAddrs(upStep, upStepPost, upStep.regs.sp), sortAddrs([MARIO_Y, SPRITE_Y_CELL]),
    "up-mover-step live-write set must be exactly {MARIO_Y, sprite-Y}");

  console.log("  NON-VACUITY: reset -> {EDGE, START_FALL}; mover-step -> {MARIO_Y, sprite-Y}; handoff -> {MARIO_ACTIVE, EDGE}");
});

test("BOUNDED EXCLUSION: the ONLY whole-dump oracle-vs-candidate diff lands in STACK_SCRATCH", () => {
  const base = attractBase();

  // An active mover-step entry (X=0x30 -> carryMarioUpWithLift, Y=0x80): the oracle writes live
  // work RAM (MARIO_Y + sprite-Y) AND the pushed 0x2721 into the stack scratch.
  const a = makeEntry(base, 0x30, 0x80, {}); // oracle
  const aFloor = a.regs.sp;
  const b = makeEntry(base, 0x30, 0x80, {}); // candidate
  oracle(a);
  loc_271e(b);
  b.ret();

  // With STACK_SCRATCH excluded the two are identical (the contract diff is null)...
  assert.equal(contractDiff(a, b, aFloor), null, "stack-excluded contract must be identical on an active dispatch");

  // ...but the WHOLE-dump diff is NON-null and lands inside STACK_SCRATCH — proving
  // the oracle really does push (so the exclusion is load-bearing) and that the push
  // is the ONLY thing it hides (so the exclusion is confined to dead scratch).
  const whole = firstStateDiff(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off));
  assert.notEqual(whole, null, "expected the oracle's push16(0x2721) to show up in the whole-dump diff");
  assert.ok(deadStackBelow(STACK_SCRATCH, aFloor)(whole.addr), `the only whole-dump diff must be in the stack scratch below the entry SP, got ${hx(whole.addr)}`);

  console.log(`  BOUNDED EXCLUSION: live RAM identical; the sole whole-dump diff is at ${hx(whole.addr)} (dead stack scratch)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG (a): drops the delegation entirely — the reposition machine never runs, so
 *  every arm's write goes missing on the active path. */
function brokenNoDelegate(_m) {
  // (intentionally empty — no dispatchElevatorRideByColumn call)
}

/** BUG (b): delegates to the wrong arm — always the reset (loc_2766), ignoring the
 *  guards and the X-band dispatch, so the two mover bands diverge. */
function brokenWrongDelegate(m) {
  loc_2766(m);
}

test("TEETH: the dropped-delegation twin is CAUGHT (an arm's writes go missing)", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenNoDelegate);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped delegation — the gate is worthless");
  assert.equal(mismatch.diff.kind, "RAM", "the dropped-delegation twin must first diverge on a missing RAM write");
  console.log(`  TEETH/no-delegate: caught — ${describeMismatch(mismatch)}`);
});

test("TEETH: the wrong-delegation twin is CAUGHT at the first mover band (MARIO_X == 44)", () => {
  const base = attractBase();
  const { mismatch } = fullSweep(base, brokenWrongDelegate);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong delegation — the gate is worthless");
  assert.equal(mismatch.x, 44, "the wrong-delegate twin must first diverge at MARIO_X == 44 (reset stole from carryMarioUpWithLift)");
  console.log(`  TEETH/wrong-delegate: caught — ${describeMismatch(mismatch)}`);
});
