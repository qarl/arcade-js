// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1cf2 (ROM 0x1CF2) — the per-frame DOWNWARD climb driver.
 *
 * loc_1cf2 reads the shared move sub-step pacer (MARIO_MOVE_STEP_TIMER, 0x620F) and
 * branches:
 *   - PACER RUNNING (non-zero): tail into tickMoveStepTimer (0x1D8A), which decrements
 *     the pacer in place; nothing else moves.
 *   - PACER EXPIRED (== 0): reload the pacer to the climb pace (3), then advance one
 *     climb sub-step DOWN by tailing into the shared stepper advanceClimbStep (0x1D11)
 *     with a +2 step. That stepper nudges MARIO_Y and dispatches to one of three
 *     already-idiomatic arms (center / ladder-end / climb-frame).
 *
 * Gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — never a register
 * file (live-out is memory-only; see the routine header). The candidate calls the
 * idiomatic callees directly; the oracle reaches the same two routines by `m.call`, so
 * this ALSO composes the callees' own equivalence.
 *
 * The Z80 reaches loc_1cf2 by a tail-jump from the mover cascade, and BOTH exits are
 * themselves tail-jumps whose callee chain ends in a single `ret` — that is loc_1cf2's
 * one net return. The idiomatic routine models no stack (direct calls + a plain JS
 * return), so the harness performs ONE m.ret() on the candidate after the call to line
 * pc + SP up with the oracle. Transient push/pop the oracle's callees do lands in
 * STACK_SCRATCH, excluded by the contract.
 *
 * 0x1CF2 is the climb-DOWN driver and the attract demo NEVER climbs down (it only
 * climbs up, via the −2 twin entry_1d03), so there are no real 0x1CF2 dispatches to
 * capture. Instead entries are seeded from real 0x1D11 climb captures (realistic
 * on-ladder RAM, a valid return stack) and steered by a surgical MARIO_MOVE_STEP_TIMER
 * poke — the "real state + one nudge" crafted-entry pattern.
 *
 *   1. EQUAL (pacer sweep, exhaustive) — over all 256 pacer values on a real climb
 *      seed: 1..255 take the tick-down path, 0 takes the reload+step path. Every value
 *      must agree with the oracle on RAM + pc + SP. Plus a non-vacuity check that the
 *      tick-down path writes ONLY the pacer, and the expiry path reloads it to 3.
 *
 *   2. EQUAL (crafted path-B arms) — force the expired path and drive the shared
 *      stepper's center phase, both ladder-end exits, and all three climb frames, each
 *      compared identically on both sides (composition coverage across advanceClimbStep).
 *
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) inverted branch — ticks when expired / reloads when running; diverges on MARIO_Y.
 *      (b) wrong reload — reloads the pacer to 4 not 3; diverges on the pacer byte.
 *      (c) wrong step — feeds the stepper +0 instead of +2; diverges on MARIO_Y.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1cf2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1cf2 as oracle } from "../../translated/loc_1cf2.js";
import { loc_1d11 as body1d11 } from "../../translated/loc_1d11.js"; // run in the capture hook
import { climbMarioDown as loc_1cf2 } from "../climbMarioDown.js";
import { tickMoveStepTimer } from "../tickMoveStepTimer.js"; // ROM 0x1D8A (for the teeth twins)
import { advanceClimbStep } from "../advanceClimbStep.js";   // ROM 0x1D11 (for the teeth twins)
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  MARIO_MOVE_STEP_TIMER,
  MARIO_Y,
  MARIO_CLIMB_LIMIT_A,
  MARIO_CLIMB_LIMIT_B,
  MARIO_ON_LADDER,
  MARIO_SPRITE_CODE,
} from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET_1CF2 = 0x1cf2;
const TARGET_1D11 = 0x1d11;
const CENTERING_PHASE = 0x6222; // shared climb-centering toggle (unnamed in names.js)
const CLIMB_PACE = 3;           // the reload value loc_1cf2 writes on expiry
const DOWN_STEP = 2;            // the +2 step loc_1cf2 feeds the shared stepper
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead
 *  stack region the standard gate excludes — the oracle's callee `ret`/`call` pops read it). */
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

/** Non-stack RAM addresses that changed between two machines (for the non-vacuity check). */
function changedAddrs(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const out = [];
  for (let i = 0; i < Math.min(da.length, db.length); i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    out.push(addr);
  }
  return out;
}

/** Run the ORACLE on a fresh clone. Its selected callee's tail chain ends in a `ret`,
 *  so pc/SP advance by one net return. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model its single net return with one m.ret()
 *  so pc + SP match the oracle's (the idiomatic routine uses the JS call stack and never
 *  touches pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO
 *  registers — live-out is memory-only. Returns human-readable mismatches. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// -- capture (seed source = real 0x1D11 climb dispatches) ---------------------

/** Hook 0x1D11 in a real attract run and clone the machine at up to K real dispatches;
 *  also count how often 0x1CF2 itself fires (expected: never, in attract). The wrapper
 *  snapshots the entry state, then runs the translated body so the host game proceeds. */
function captureClimbSeeds(K, maxFrames) {
  const seeds = [];
  let downCount = 0;
  const overrides = new Map([
    [TARGET_1D11, (mm) => { if (seeds.length < K) seeds.push(mm.clone()); return body1d11(mm); }],
    [TARGET_1CF2, (mm) => { downCount++; return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return { seeds, downCount };
}

/** A real climb seed with the pacer byte poked (steers loc_1cf2's own branch). */
function craftPacer(seed, timer) {
  const e = seed.clone();
  e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  return e;
}

/** A real climb seed forced onto the expiry path (pacer 0) with the stepper's steering
 *  cells poked, to drive a specific advanceClimbStep arm. */
function craftPathB(seed, { marioY, phase, limitA, limitB }) {
  const e = seed.clone();
  e.mem.write8(MARIO_MOVE_STEP_TIMER, 0);
  if (marioY !== undefined) e.mem.write8(MARIO_Y, marioY);
  if (phase !== undefined) e.mem.write8(CENTERING_PHASE, phase);
  if (limitA !== undefined) e.mem.write8(MARIO_CLIMB_LIMIT_A, limitA);
  if (limitB !== undefined) e.mem.write8(MARIO_CLIMB_LIMIT_B, limitB);
  return e;
}

// -- teeth twins (same shape as loc_1cf2) -------------------------------------

/** (a) INVERTED BRANCH — ticks when the pacer is expired, reloads+steps when running. */
function twinInvertBranch(m) {
  const { mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) === 0) { tickMoveStepTimer(m); return; } // BUG: inverted
  mem.write8(MARIO_MOVE_STEP_TIMER, CLIMB_PACE);
  advanceClimbStep(m, DOWN_STEP);
}

/** (b) WRONG RELOAD — reloads the pacer to 4 instead of the climb pace 3. */
function twinWrongReload(m) {
  const { mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) { tickMoveStepTimer(m); return; }
  mem.write8(MARIO_MOVE_STEP_TIMER, 4); // BUG: should be 3
  advanceClimbStep(m, DOWN_STEP);
}

/** (c) WRONG STEP — feeds the shared stepper +0 instead of the +2 down step. */
function twinWrongStep(m) {
  const { mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) { tickMoveStepTimer(m); return; }
  mem.write8(MARIO_MOVE_STEP_TIMER, CLIMB_PACE);
  advanceClimbStep(m, 0); // BUG: should be +2
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1CF2 is absent from attract (climb-down); seeds come from 0x1D11", () => {
  const { seeds, downCount } = captureClimbSeeds(4, 8000);
  assert.ok(seeds.length >= 1, "expected at least one real 0x1D11 climb dispatch to seed from");
  assert.equal(downCount, 0, "attract is not expected to climb DOWN, so 0x1CF2 should not dispatch");
  console.log(`  REACHABILITY: ${seeds.length}+ real 0x1D11 climb seeds; 0x1CF2 dispatched ${downCount}x in attract (crafted-entry gate)`);
});

// -- 1. EQUAL (pacer sweep, exhaustive) ---------------------------------------

test("EQUAL (pacer sweep): loc_1cf2 == oracle for all 256 pacer values on a real climb seed", () => {
  const { seeds } = captureClimbSeeds(1, 8000);
  assert.ok(seeds.length >= 1, "need a real 0x1D11 climb seed");
  const seed = seeds[0];

  let ticked = 0, stepped = 0;
  for (let t = 0; t < 256; t++) {
    const entry = craftPacer(seed, t);
    const diffs = contractDiffs(entry, loc_1cf2);
    assert.equal(diffs.length, 0, `pacer=${hx(t)}: ${diffs.join("; ")}`);
    if (t === 0) stepped++; else ticked++;
  }

  // Non-vacuity: the tick-down path writes ONLY the pacer (decrement, no stepper work),
  // and the expiry path reloads the pacer to the climb pace.
  const tickEntry = craftPacer(seed, 5);
  const tickOracle = runOracle(tickEntry);
  assert.deepEqual(changedAddrs(tickEntry, tickOracle, tickEntry.regs.sp), [MARIO_MOVE_STEP_TIMER],
    "tick-down path must write only MARIO_MOVE_STEP_TIMER");
  assert.equal(tickOracle.mem.read8(MARIO_MOVE_STEP_TIMER), 4, "pacer 5 must tick down to 4");
  const stepOracle = runOracle(craftPacer(seed, 0));
  assert.equal(stepOracle.mem.read8(MARIO_MOVE_STEP_TIMER), CLIMB_PACE,
    "expiry path must reload the pacer to the climb pace 3");

  console.log(`  EQUAL/pacer-sweep: 256 pacer values identical (${ticked} tick-down, ${stepped} reload+step)`);
});

// -- 2. EQUAL (crafted path-B arms) -------------------------------------------

test("EQUAL (crafted): expiry path drives center / both ladder-ends / all three climb frames", () => {
  const { seeds } = captureClimbSeeds(1, 8000);
  assert.ok(seeds.length >= 1, "need a real 0x1D11 climb seed");
  const seed = seeds[0];

  const Y0 = 0x60;                         // chosen height
  const probe = u8(Y0 + DOWN_STEP + 8);    // (newY + 8) after the +2 step

  const cases = [
    // Center phase: toggle flips 0 -> 1 (non-zero), so the centering path runs (0x1D51).
    { name: "center phase", opts: { marioY: Y0, phase: 0x00 },
      expect: (o) => {
        assert.equal(o.mem.read8(CENTERING_PHASE), 1, "toggle must flip to 1");
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 1, "centering path re-asserts on-ladder");
        assert.equal(o.mem.read8(MARIO_Y), u8(Y0 + DOWN_STEP), "MARIO_Y must advance by the +2 step");
      } },
    // Ladder-end via LIMIT_B (tested first).
    { name: "end at LIMIT_B", opts: { marioY: Y0, phase: 0x01, limitB: probe, limitA: u8(probe + 0x40) },
      expect: (o) => {
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 0, "ladder-end dismount clears on-ladder");
        assert.equal(o.mem.read8(MARIO_SPRITE_CODE), 0x06, "ladder-end pose is 0x06");
      } },
    // Ladder-end via LIMIT_A (LIMIT_B must miss first).
    { name: "end at LIMIT_A", opts: { marioY: Y0, phase: 0x01, limitB: u8(probe + 1), limitA: probe },
      expect: (o) => {
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 0, "ladder-end dismount clears on-ladder");
        assert.equal(o.mem.read8(MARIO_SPRITE_CODE), 0x06, "ladder-end pose is 0x06");
      } },
    // Climb frame 5: distance above near limit == 8.
    { name: "climb frame 5 (dist 8)", opts: { marioY: Y0, phase: 0x01, limitB: u8(probe + 3), limitA: u8(probe - 8) },
      expect: (o) => {
        assert.equal(o.mem.read8(MARIO_ON_LADDER), 1, "climb-frame path re-asserts on-ladder");
        assert.equal(o.mem.read8(MARIO_SPRITE_CODE) & 0x07, 5, "frame 5 in the sprite code");
      } },
    // Climb frame 4: distance == 12.
    { name: "climb frame 4 (dist 12)", opts: { marioY: Y0, phase: 0x01, limitB: u8(probe + 3), limitA: u8(probe - 12) },
      expect: (o) => assert.equal(o.mem.read8(MARIO_SPRITE_CODE) & 0x07, 4, "frame 4 in the sprite code") },
    // Climb frame 3: any other distance (20).
    { name: "climb frame 3 (dist 20)", opts: { marioY: Y0, phase: 0x01, limitB: u8(probe + 7), limitA: u8(probe - 20) },
      expect: (o) => assert.equal(o.mem.read8(MARIO_SPRITE_CODE) & 0x07, 3, "frame 3 in the sprite code") },
  ];

  for (const { name, opts, expect } of cases) {
    const entry = craftPathB(seed, opts);
    const diffs = contractDiffs(entry, loc_1cf2);
    assert.equal(diffs.length, 0, `${name}: ${diffs.join("; ")}`);
    expect(runOracle(entry)); // confirm the oracle really took the intended arm
  }
  console.log(`  EQUAL/crafted: ${cases.length} expiry-path arms (center, 2x ladder-end, 3x climb frame) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the inverted-branch, wrong-reload, and wrong-step twins are CAUGHT", () => {
  const { seeds } = captureClimbSeeds(1, 8000);
  assert.ok(seeds.length >= 1, "need a real 0x1D11 climb seed");
  const seed = seeds[0];

  const Y0 = 0x60;

  // (a) inverted branch: pacer RUNNING (5) — correct only ticks the pacer (no stepper
  //     work at all), the twin wrongly reloads and steps, so it writes the stepper's
  //     Mario cells (the centering arm stamps the Mario object block). Diverges in that
  //     block; the correct routine touched none of it.
  const invBait = craftPacer(seed, 5);
  invBait.mem.write8(MARIO_Y, Y0);
  invBait.mem.write8(CENTERING_PHASE, 0x00);
  const inv = contractDiffs(invBait, twinInvertBranch);
  assert.ok(inv.length > 0, "the inverted-branch twin escaped — the gate is worthless");
  assert.ok(/^RAM@0x62/.test(inv[0]), `expected the inverted-branch diff in the Mario block, got ${inv[0]}`);

  // (b) wrong reload: pacer EXPIRED, center phase — MARIO_Y matches, but the pacer reload
  //     differs (3 vs 4). Diverges at MARIO_MOVE_STEP_TIMER.
  const relBait = craftPathB(seed, { marioY: Y0, phase: 0x00 });
  const rel = contractDiffs(relBait, twinWrongReload);
  assert.ok(rel.length > 0, "the wrong-reload twin escaped — the gate is worthless");
  assert.ok(rel[0].startsWith(`RAM@0x${MARIO_MOVE_STEP_TIMER.toString(16)}`),
    `expected the wrong-reload diff at MARIO_MOVE_STEP_TIMER, got ${rel[0]}`);

  // (c) wrong step: pacer EXPIRED, center phase — correct steps +2, twin steps +0.
  //     Diverges at MARIO_Y.
  const stepBait = craftPathB(seed, { marioY: Y0, phase: 0x00 });
  const step = contractDiffs(stepBait, twinWrongStep);
  assert.ok(step.length > 0, "the wrong-step twin escaped — the gate is worthless");
  assert.ok(step[0].startsWith(`RAM@0x${MARIO_Y.toString(16)}`),
    `expected the wrong-step diff at MARIO_Y, got ${step[0]}`);

  console.log(`  TEETH: inverted-branch caught (${inv[0]}); wrong-reload caught (${rel[0]}); wrong-step caught (${step[0]})`);
});
