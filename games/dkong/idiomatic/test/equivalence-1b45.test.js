// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1b45 (ROM 0x1B45) — the "holding Up -> climb up" input guard.
 *
 * loc_1b45 branches on ONE byte, P1_INPUT (0x6010), testing its UP bit (bit 2 = 0x04):
 *   - bit 2 SET (Up held): hand off to the climb-UP driver climbMarioUp, which paces and
 *     advances Mario's ladder climb this frame.
 *   - bit 2 CLEAR (Up not held): do nothing and return; no memory is written.
 * climbMarioUp is already idiomatic and direct-called; the oracle reaches it by `m.call`,
 * so this gate also composes climbMarioUp's own equivalence (and its callees').
 *
 * The oracle enters by a tail-call from loc_1b38, takes no register live-in it does not
 * immediately overwrite, and both paths net exactly ONE `ret`: the Up arm tail-jumps into
 * 0x1D03 whose chain ends in a single `ret` (returning on the caller's behalf), and the
 * idle arm does its own `ret`. The idiomatic routine models no stack (a direct call + a
 * plain JS return), so the harness performs ONE m.ret() on the candidate clone after the
 * call to line pc + SP up with the oracle. Transient push/pop the oracle's deeper callees
 * do lands in STACK_SCRATCH, excluded by the memory-equivalence contract (RAM −
 * STACK_SCRATCH + pc + SP; live-out is memory-only).
 *
 *   1. EQUAL (real dispatches) — hook 0x1B45 in a real attract run and compare oracle vs
 *      candidate on RAM + pc + SP for every captured entry. The upstream input dispatch only
 *      routes here mid-climb, and the attract demo holds Up whenever it does, so every real
 *      dispatch takes the climb arm; the idle arm (Up clear) is covered by the crafted sweep.
 *
 *   2. EQUAL (input sweep) — from a real captured state, sweep P1_INPUT over all 256 values,
 *      comparing both sides each time. This pins the exact bit-2 test: exactly the 128
 *      values with bit 2 set take the climb arm. Non-vacuity: a crafted timer==0 entry on
 *      the Up arm is shown to run the climb (reloads the move-step timer to 4 and moves
 *      MARIO_Y up by two), and an idle entry is shown to write nothing.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) inverted-guard — climbs when Up is NOT held and idles when it is; caught on an
 *          Up-held timer==0 entry (oracle climbs and writes, twin idles).
 *      (b) wrong-bit — tests the LEFT bit (bit 1) instead of the UP bit (bit 2); caught on
 *          a control word with only bit 2 set (oracle climbs, twin idles).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1b45.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1b45 as oracle } from "../../translated/loc_1b45.js";
import { climbUpWhileHeld } from "../climbUpWhileHeld.js"; // promoted from loc_1b45
import { climbMarioUp } from "../climbMarioUp.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, P1_INPUT, MARIO_MOVE_STEP_TIMER, MARIO_Y } from "../names.js";
import { u8 } from "../../../../core/int.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1b45;
const UP_BIT = 0x04; // bit 2 of the cooked control word = Up held
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
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

/** Run the ORACLE on a fresh clone. Its selected path ends in a `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

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

/** Hook 0x1B45 in a real attract run and clone the machine at up to K real dispatches. The
 *  wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 *  undisturbed. loc_1b38 reaches here by `m.call(0x1b45)`, resolved through the registry the
 *  override overlays, so every real input-guard dispatch is caught. */
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

/** A real captured state with P1_INPUT poked to a chosen value (the branch selector). The
 *  real SP is kept (a valid return stack the game itself produced), so the ret modeling is
 *  honest. `timer` optionally pins the move-step timer to force the climb-step sub-arm. */
function withInput(seed, input, timer) {
  const e = seed.clone();
  e.mem.write8(P1_INPUT, input);
  if (timer !== undefined) e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  return e;
}

/** Broken twin (a): INVERTED-GUARD — climbs when Up is NOT held and idles when it is. */
function brokenInvertedGuard(m) {
  const { mem } = m;
  if ((mem.read8(P1_INPUT) & UP_BIT) === 0) { // BUG: should climb when the bit is SET
    climbMarioUp(m);
  }
}

/** Broken twin (b): WRONG-BIT — tests the LEFT bit (bit 1 = 0x02) instead of the UP bit. */
function brokenWrongBit(m) {
  const { mem } = m;
  if (mem.read8(P1_INPUT) & 0x02) { // BUG: 0x02 is the Left bit, not Up (0x04)
    climbMarioUp(m);
  }
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1B45 is dispatched during attract (climb arm natural; idle arm crafted)", () => {
  const caps = captureDispatches(256, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1B45 dispatch — the input dispatch routes here");
  const up = caps.filter((c) => (c.mem.read8(P1_INPUT) & UP_BIT) !== 0).length;
  const idle = caps.length - up;
  assert.ok(up >= 1, "expected at least one Up-held (climb-arm) dispatch — attract climbs ladders");
  console.log(`  REACHABILITY: ${caps.length} natural 0x1B45 dispatches (${up} climb arm, ${idle} idle arm; idle arm exercised by the crafted sweep)`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1b45 == oracle on every captured 0x1B45 entry", () => {
  const caps = captureDispatches(256, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1B45 dispatch during attract");
  let up = 0, idle = 0;
  for (const cap of caps) {
    const diffs = contractDiffs(cap, climbUpWhileHeld); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    if ((cap.mem.read8(P1_INPUT) & UP_BIT) !== 0) up++; else idle++;
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP (${up} climb arm, ${idle} idle arm)`);
});

// -- 2. EQUAL (input sweep) ---------------------------------------------------

test("EQUAL (input sweep): all 256 P1_INPUT values match the oracle", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need one real capture to seed the input sweep with real RAM");
  const seed = caps[0];

  let climbArm = 0, idleArm = 0;
  for (let v = 0; v < 256; v++) {
    const entry = withInput(seed, v);
    const diffs = contractDiffs(entry, climbUpWhileHeld);
    assert.equal(diffs.length, 0, `input=${hx(v)}: ${diffs.join("; ")}`);
    if ((v & UP_BIT) !== 0) climbArm++; else idleArm++;
  }
  assert.equal(climbArm, 128, "exactly the 128 values with bit 2 set take the climb arm");
  assert.equal(idleArm, 128, "exactly the 128 values with bit 2 clear take the idle arm");

  // Non-vacuity for the climb arm: with Up held and the move-step timer expired, the oracle
  // runs the climb — reloads the timer to 4 and moves Mario up by two (climbMarioUp's step).
  const climbEntry = withInput(seed, UP_BIT, 0);
  const origY = climbEntry.mem.read8(MARIO_Y);
  const afterClimb = runOracle(climbEntry);
  assert.equal(afterClimb.mem.read8(MARIO_MOVE_STEP_TIMER), 4, "climb arm reloads the move-step timer to 4");
  assert.equal(afterClimb.mem.read8(MARIO_Y), u8(origY - 2), "climb arm advances Mario UP by two");

  // Non-vacuity for the idle arm: with Up clear, nothing non-stack is written.
  const idleEntry = withInput(seed, 0x00);
  const afterIdle = runOracle(idleEntry);
  assert.deepEqual(changedAddrs(idleEntry, afterIdle, idleEntry.regs.sp), [], "idle arm must not write any non-stack RAM");

  console.log(`  EQUAL/sweep: 256 input values identical on RAM+pc+SP (128 climb arm, 128 idle arm); climb arm reloads 4 + moves Y ${hx(origY)}->${hx(u8(origY - 2))}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: inverted-guard and wrong-bit twins are CAUGHT", () => {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth baits");
  const seed = caps[0];

  // (a) inverted-guard: Up held + timer expired — the oracle climbs (writes the move-step
  //     timer and Mario's position) while the twin idles. The two arms write disjoint memory,
  //     so the swap is caught.
  const invBait = withInput(seed, UP_BIT, 0);
  assert.equal(runOracle(invBait).mem.read8(MARIO_MOVE_STEP_TIMER), 4, "inverted bait must reach the climb on the oracle");
  const inverted = contractDiffs(invBait, brokenInvertedGuard);
  assert.ok(inverted.length > 0, "the inverted-guard twin escaped — the gate is worthless");

  // (b) wrong-bit: only bit 2 set (Left bit clear) + timer expired — the oracle climbs
  //     (bit 2), the twin tests the Left bit and idles. Caught, and this pins the "Up" bit
  //     the routine's guard asserts (0x04, not 0x02).
  const bitBait = withInput(seed, UP_BIT, 0); // 0x04: Up set, Left clear
  const wrongBit = contractDiffs(bitBait, brokenWrongBit);
  assert.ok(wrongBit.length > 0, "the wrong-bit twin escaped — the gate is worthless");

  console.log(`  TEETH: inverted-guard caught (${inverted[0]}); wrong-bit caught (${wrongBit[0]})`);
});
