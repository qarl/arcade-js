// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for climbMarioUp (ROM 0x1D03) — the climb-UP animation driver.
 *
 * climbMarioUp branches on ONE byte, MARIO_MOVE_STEP_TIMER (0x620F):
 *   - timer != 0 (mid-hold): hand off to loc_1d76, which conditionally ticks the timer
 *     down; Mario does not move this frame.
 *   - timer == 0 (expired): reload the timer to 4, then advance one climb step UP by
 *     invoking the shared climb stepper advanceClimbStep with a step of −2.
 * Both callees are already idiomatic and direct-called; the oracle reaches them by
 * `m.call`, so this gate also composes their own equivalence.
 *
 * The oracle enters this body by a tail-jump (loc_1b45 `jp nz 0x1d03`), takes no register
 * live-in it does not immediately overwrite, and every path tail-jumps into a callee whose
 * chain ends in exactly ONE `ret` — that single `ret` returns on the caller's behalf. The
 * idiomatic routine models no stack (direct calls + a plain JS return), so the harness
 * performs ONE m.ret() on the candidate clone after the call to line pc + SP up with the
 * oracle. Transient push/pop the oracle's deeper callees do lands in STACK_SCRATCH,
 * excluded by the memory-equivalence contract (RAM − the stack scratch below the entry SP + pc + SP; live-out is
 * memory-only).
 *
 *   1. EQUAL (real dispatches) — hook 0x1D03 in a real attract run (Mario climbs ladders,
 *      so BOTH arms fire naturally: timer 0 for the step arm, 1..4 for the hold arm).
 *      oracle vs candidate must agree on RAM + pc + SP for every capture.
 *
 *   2. EQUAL (timer sweep) — from a real captured state, sweep MARIO_MOVE_STEP_TIMER over
 *      all 256 values, comparing both sides each time. This pins the exact branch boundary
 *      (only 0 takes the step arm) and, on the step arm, the reload-to-4 and the −2 climb
 *      step. Non-vacuity: the sweep is asserted to exercise both arms, and the step arm is
 *      checked to reload the timer to 4 and move MARIO_Y up by two.
 *
 *   3. TEETH — three deliberately-broken twins, each MUST be caught:
 *      (a) inverted-branch — swaps the two arms; diverges on MARIO_Y (one arm moves it,
 *          the other does not).
 *      (b) wrong-reload — reloads the timer to 3 instead of 4; diverges on
 *          MARIO_MOVE_STEP_TIMER on the step arm.
 *      (c) climb-DOWN — feeds the stepper +2 instead of −2; diverges on MARIO_Y (this is
 *          what pins the "Up" in climbMarioUp).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1d03.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d03 as oracle } from "../../translated/loc_1d03.js";
import { climbMarioUp } from "../climbMarioUp.js";
import { loc_1d76 } from "../loc_1d76.js";
import { advanceClimbStep } from "../advanceClimbStep.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_MOVE_STEP_TIMER, MARIO_Y } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1d03;
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

/** Run the ORACLE on a fresh clone. Its selected callee chain ends in a `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model the chain's single net return with one
 *  m.ret() so pc + SP match the oracle's (the idiomatic routine uses the JS call stack and
 *  never touches pc/SP itself). */
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

// -- capture ------------------------------------------------------------------

/** Hook 0x1D03 in a real attract run and clone the machine at up to K real dispatches.
 *  The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 *  undisturbed. loc_1b45 reaches here by `m.call(0x1d03)`, resolved through the registry
 *  the override overlays, so every real climb-up dispatch is caught. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

/** A real captured state with MARIO_MOVE_STEP_TIMER poked to a chosen value (the branch
 *  selector). The real SP is kept (a valid return stack the game itself produced), so the
 *  ret modeling is honest. */
function withTimer(seed, timer) {
  const e = seed.clone();
  e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  return e;
}

// -- teeth twins (same shape as climbMarioUp, one thing broken) ---------------

/** Broken twin (a): INVERTED-BRANCH — steps when the timer is running and holds when it
 *  expired, the exact opposite of the oracle. */
function brokenInvertedBranch(m) {
  const { mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) === 0) { // BUG: should be `!== 0`
    loc_1d76(m);
    return;
  }
  mem.write8(MARIO_MOVE_STEP_TIMER, 4);
  advanceClimbStep(m, -2);
}

/** Broken twin (b): WRONG-RELOAD — restarts the cadence at 3 instead of 4. */
function brokenWrongReload(m) {
  const { mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) {
    loc_1d76(m);
    return;
  }
  mem.write8(MARIO_MOVE_STEP_TIMER, 3); // BUG: should reload 4
  advanceClimbStep(m, -2);
}

/** Broken twin (c): CLIMB-DOWN — feeds the shared stepper +2 (down) instead of −2 (up). */
function brokenClimbDown(m) {
  const { mem } = m;
  if (mem.read8(MARIO_MOVE_STEP_TIMER) !== 0) {
    loc_1d76(m);
    return;
  }
  mem.write8(MARIO_MOVE_STEP_TIMER, 4);
  advanceClimbStep(m, 2); // BUG: +2 is the climb-DOWN step
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1D03 is dispatched during attract, both arms", () => {
  const caps = captureDispatches(256, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1D03 dispatch — attract climbs ladders");
  const step = caps.filter((c) => c.mem.read8(MARIO_MOVE_STEP_TIMER) === 0).length;
  const hold = caps.length - step;
  assert.ok(step >= 1, "expected at least one timer==0 (climb-step) dispatch");
  assert.ok(hold >= 1, "expected at least one timer!=0 (hold) dispatch");
  console.log(`  REACHABILITY: ${caps.length} natural 0x1D03 dispatches (${step} step arm, ${hold} hold arm)`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): climbMarioUp == oracle on every captured 0x1D03 entry", () => {
  const caps = captureDispatches(256, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1D03 dispatch during attract");
  let step = 0, hold = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, climbMarioUp); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if (cap.mem.read8(MARIO_MOVE_STEP_TIMER) === 0) step++; else hold++;
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP (${step} step arm, ${hold} hold arm)`);
});

// -- 2. EQUAL (timer sweep) ---------------------------------------------------

test("EQUAL (timer sweep): all 256 MARIO_MOVE_STEP_TIMER values match the oracle", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need one real capture to seed the timer sweep with real RAM");
  const seed = caps[0];
  const origY = seed.mem.read8(MARIO_Y);

  let stepArm = 0, holdArm = 0;
  for (let t = 0; t < 256; t++) {
    const entry = withTimer(seed, t);
    const diffs = contractDiffs(entry, climbMarioUp);
    assert.equal(diffs.length, 0, `timer=${hx(t)}: ${diffs.join("; ")}`);
    if (t === 0) stepArm++; else holdArm++;
  }
  assert.equal(stepArm, 1, "exactly the timer==0 value takes the climb-step arm");
  assert.equal(holdArm, 255, "every non-zero timer takes the hold arm");

  // Non-vacuity for the step arm: the oracle reloads the timer to 4 and moves Mario up by
  // two on timer==0 (the behaviour the sweep verified byte-for-byte).
  const afterStep = runOracle(withTimer(seed, 0));
  assert.equal(afterStep.mem.read8(MARIO_MOVE_STEP_TIMER), 4, "step arm reloads the timer to 4");
  assert.equal(afterStep.mem.read8(MARIO_Y), u8(origY - 2), "step arm advances Mario UP by two");
  // Non-vacuity for the hold arm: MARIO_Y is untouched when the timer is still running.
  const afterHold = runOracle(withTimer(seed, 3));
  assert.equal(afterHold.mem.read8(MARIO_Y), origY, "hold arm does not move Mario");

  console.log(`  EQUAL/sweep: 256 timer values identical on RAM+pc+SP (1 step arm, 255 hold arm); step arm reloads 4 + moves Y ${hx(origY)}->${hx(u8(origY - 2))}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: inverted-branch, wrong-reload, and climb-down twins are CAUGHT", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth baits");
  const seed = caps[0];

  // (a) inverted-branch: on a timer==0 entry the oracle takes the step arm (moving Mario
  //     and its centering cells) while the twin holds — the two arms write disjoint memory,
  //     so the swap is caught. The exact first-divergent cell is arm-dependent (the step
  //     arm's centering path writes several position cells), so only the catch is asserted.
  const invBait = withTimer(seed, 0);
  const inverted = contractDiffs(invBait, brokenInvertedBranch);
  assert.ok(inverted.length > 0, "the inverted-branch twin escaped — the gate is worthless");

  // (b) wrong-reload: timer==0 entry — the step body is otherwise identical (same −2 step),
  //     so the ONLY divergence is the reloaded timer value at MARIO_MOVE_STEP_TIMER.
  const reloadBait = withTimer(seed, 0);
  const wrongReload = contractDiffs(reloadBait, brokenWrongReload);
  assert.ok(wrongReload.length > 0, "the wrong-reload twin escaped — the gate is worthless");
  assert.ok(wrongReload[0].startsWith(`RAM@0x${MARIO_MOVE_STEP_TIMER.toString(16)}`),
    `expected the wrong-reload diff at MARIO_MOVE_STEP_TIMER, got ${wrongReload[0]}`);

  // (c) climb-down: timer==0 entry — feeding the stepper +2 instead of −2 moves Mario the
  //     wrong way. Caught, and MARIO_Y explicitly ends up different — this pins the "Up"
  //     direction the routine's name asserts.
  const dirBait = withTimer(seed, 0);
  const climbDown = contractDiffs(dirBait, brokenClimbDown);
  assert.ok(climbDown.length > 0, "the climb-down twin escaped — the gate is worthless");
  const oUp = runOracle(dirBait).mem.read8(MARIO_Y);
  const cDown = runCandidate(dirBait, brokenClimbDown).mem.read8(MARIO_Y);
  assert.notEqual(oUp, cDown, "climb-down twin must land MARIO_Y elsewhere than the climb-up oracle");
  assert.equal(oUp, u8(seed.mem.read8(MARIO_Y) - 2), "oracle (climb-up) moves MARIO_Y up by two");

  console.log(
    `  TEETH: inverted-branch caught (${inverted[0]}); wrong-reload caught (${wrongReload[0]}); ` +
      `climb-down caught (${climbDown[0]})`,
  );
});
