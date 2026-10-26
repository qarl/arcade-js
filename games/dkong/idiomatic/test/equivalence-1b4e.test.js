// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_1b4e (ROM 0x1B4E) — the "commit the climb-limit pair, then keep
 * climbing" tail of the hammer-climb collision handler.
 *
 * loc_1b4e stores two ladder-extent limits, handed in by its still-translated caller
 * (armMarioClimbAtLadderEnd), into MARIO_CLIMB_LIMIT_A (0x621B) and MARIO_CLIMB_LIMIT_B (0x621C), then falls
 * straight into the Up-climb input guard climbUpWhileHeld (ROM 0x1B45). The caller always
 * points at the block base just below the pair (0x621A), so the two stores resolve to the two
 * named cells; the two limit VALUES arrive in registers (a genuine oracle boundary), so they
 * are read from there. This branch stores first->A, second->B; the caller's own fall-through
 * stores the same pair SWAPPED, which is exactly the teeth bait below.
 *
 * The oracle reaches climbUpWhileHeld by a tail `jp` and the whole chain nets exactly ONE
 * `ret` (the Up arm tail-jumps into the climb driver whose chain ends in one `ret`; the idle
 * arm does its own `ret`). The idiomatic routine models no stack (two writes + a direct call +
 * a plain JS return), so the harness performs ONE m.ret() on the candidate clone after the
 * call to line pc + SP up with the oracle. The transient push/pop the dissolved climb tail-call
 * churns lands in STACK_SCRATCH, excluded by the memory-equivalence contract (RAM −
 * STACK_SCRATCH + pc + SP; live-out is memory-only).
 *
 *   1. EQUAL (real dispatches) — hook 0x1B4E in a real attract run and compare oracle vs
 *      candidate on RAM + pc + SP for every captured entry. The hammer-climb path fires it, and
 *      the demo holds Up whenever it does, so every real dispatch takes the climb arm; the idle
 *      arm (Up clear) is covered by the crafted entries. Every capture has HL = 0x621A, the
 *      invariant that justifies resolving the two stores to the named cells.
 *
 *   2. EQUAL (crafted) — from a real captured state, poke the two limit values + P1_INPUT to
 *      drive: the Up-held climb arm (distinct A/B values, timer expired so the climb advances)
 *      and the idle arm (Up clear). Both match the oracle, and non-vacuity is pinned: the two
 *      cells hold exactly the two register values afterward, the idle arm writes NOTHING outside
 *      the pair, and the climb arm reaches the driver (move-step timer reloaded to 4).
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) swapped-order — stores the pair in the caller's fall-through order (A<-second,
 *          B<-first); caught at MARIO_CLIMB_LIMIT_A when the two limits differ.
 *      (b) dropped-write — stores only the first limit and drops the second; caught at
 *          MARIO_CLIMB_LIMIT_B.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1b4e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1b4e as oracle } from "../../translated/loc_1b4e.js";
import { loc_1b4e } from "../loc_1b4e.js";
import { climbUpWhileHeld } from "../climbUpWhileHeld.js"; // ROM 0x1B45 — used by the teeth twins
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH,
  P1_INPUT,
  MARIO_CLIMB_LIMIT_A,
  MARIO_CLIMB_LIMIT_B,
  MARIO_MOVE_STEP_TIMER,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1b4e;
const UP_BIT = 0x04; // bit 2 of the cooked control word = Up held
const CLIMB_BASE = 0x621a; // the caller's invariant HL: the block base just below the limit pair
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack
 *  region the dissolved climb tail-call churns — the standard gate excludes it). */
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

/** All non-stack RAM addresses that changed between two machines (for the write-set checks). */
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

/** Run a candidate on a fresh clone, then model the chain's single net return with one
 *  m.ret() so pc + SP match the oracle's (the idiomatic routine uses the JS call stack and
 *  never touches pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. NO registers —
 *  live-out is memory-only. Returns human-readable mismatches. */
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

/** Hook 0x1B4E in a real attract run and clone the machine at up to K real dispatches. The
 *  wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 *  undisturbed. armMarioClimbAtLadderEnd reaches here by `m.call(0x1b4e)`, resolved through the registry the
 *  override overlays, so every real hammer-climb dispatch is caught. */
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

/** A real captured state with the two limit registers / P1_INPUT / move-step timer poked. The
 *  real SP is kept (a valid return stack the game itself produced), so the ret modeling is
 *  honest, and the real HL (0x621A) is kept so the stores resolve to the named cells. */
function craft(base, { b, d, input, timer, preA, preB } = {}) {
  const e = base.clone();
  if (b !== undefined) e.regs.b = b;
  if (d !== undefined) e.regs.d = d;
  if (input !== undefined) e.mem.write8(P1_INPUT, input);
  if (timer !== undefined) e.mem.write8(MARIO_MOVE_STEP_TIMER, timer);
  if (preA !== undefined) e.mem.write8(MARIO_CLIMB_LIMIT_A, preA);
  if (preB !== undefined) e.mem.write8(MARIO_CLIMB_LIMIT_B, preB);
  return e;
}

// -- teeth twins (same shape as loc_1b4e, one thing broken) -------------------

/** Broken twin (a): SWAPPED-ORDER — stores the pair in the caller's fall-through order. */
function brokenSwappedOrder(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_CLIMB_LIMIT_A, regs.d); // BUG: should be the first limit (regs.b)
  mem.write8(MARIO_CLIMB_LIMIT_B, regs.b); // BUG: should be the second limit (regs.d)
  climbUpWhileHeld(m);
}

/** Broken twin (b): DROPPED-WRITE — stores only the first limit, drops the second. */
function brokenDroppedWrite(m) {
  const { regs, mem } = m;
  mem.write8(MARIO_CLIMB_LIMIT_A, regs.b);
  // BUG: dropped the second climb-limit store (MARIO_CLIMB_LIMIT_B <- regs.d)
  climbUpWhileHeld(m);
}

// -- 0. reachability ----------------------------------------------------------

test("REACHABILITY: 0x1B4E is dispatched during attract (all with HL=0x621A; climb arm natural)", () => {
  const caps = captureDispatches(64, 9000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1B4E dispatch — the hammer-climb path routes here");
  for (const c of caps) {
    assert.equal(c.regs.hl, CLIMB_BASE, `every 0x1B4E dispatch must arrive with HL=0x621A, got 0x${c.regs.hl.toString(16)}`);
  }
  const up = caps.filter((c) => (c.mem.read8(P1_INPUT) & UP_BIT) !== 0).length;
  // The demo holds Up on the frames it climbs, so real dispatches take the climb arm; the idle
  // arm (Up clear) is covered by the crafted entries below — the standard unhit-path pattern.
  assert.ok(up >= 1, "expected at least one Up-held (climb-arm) dispatch — attract climbs ladders");
  console.log(`  REACHABILITY: ${caps.length} natural 0x1B4E dispatches, all HL=0x621A (${up} climb arm; idle arm crafted)`);
});

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): loc_1b4e == oracle on every captured 0x1B4E entry", () => {
  const caps = captureDispatches(64, 9000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1B4E dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, loc_1b4e); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
    // The oracle really commits the pair: after it runs, the two named cells hold B and D.
    const after = runOracle(cap);
    assert.equal(after.mem.read8(MARIO_CLIMB_LIMIT_A), cap.regs.b, "MARIO_CLIMB_LIMIT_A <- first limit");
    assert.equal(after.mem.read8(MARIO_CLIMB_LIMIT_B), cap.regs.d, "MARIO_CLIMB_LIMIT_B <- second limit");
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical on RAM+pc+SP; both climb-limit cells committed`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): the climb arm and the idle arm both match the oracle", () => {
  const caps = captureDispatches(1, 9000);
  assert.ok(caps.length >= 1, "need one real capture to seed the crafted arms with real RAM + stack");
  const seed = caps[0];

  // Climb arm: Up held, timer expired so the climb driver advances a step. Distinct A/B values.
  const climb = craft(seed, { b: 0x11, d: 0x22, input: UP_BIT, timer: 0, preA: 0x00, preB: 0x00 });
  const climbDiffs = contractDiffs(climb, loc_1b4e);
  assert.equal(climbDiffs.length, 0, `climb arm: ${climbDiffs.join("; ")}`);
  const climbAfter = runOracle(climb);
  assert.equal(climbAfter.mem.read8(MARIO_CLIMB_LIMIT_A), 0x11, "climb arm: MARIO_CLIMB_LIMIT_A <- first limit");
  assert.equal(climbAfter.mem.read8(MARIO_CLIMB_LIMIT_B), 0x22, "climb arm: MARIO_CLIMB_LIMIT_B <- second limit");
  assert.equal(climbAfter.mem.read8(MARIO_MOVE_STEP_TIMER), 4, "climb arm reached the driver (move-step timer reloaded to 4)");

  // Idle arm: Up clear, so climbUpWhileHeld does nothing — only the two climb-limit writes fire.
  const idle = craft(seed, { b: 0x33, d: 0x44, input: 0x00, preA: 0x00, preB: 0x00 });
  const idleDiffs = contractDiffs(idle, loc_1b4e);
  assert.equal(idleDiffs.length, 0, `idle arm: ${idleDiffs.join("; ")}`);
  const idleAfter = runOracle(idle);
  assert.equal(idleAfter.mem.read8(MARIO_CLIMB_LIMIT_A), 0x33, "idle arm: MARIO_CLIMB_LIMIT_A <- first limit");
  assert.equal(idleAfter.mem.read8(MARIO_CLIMB_LIMIT_B), 0x44, "idle arm: MARIO_CLIMB_LIMIT_B <- second limit");
  // Non-vacuity: the idle arm touches ONLY the two limit cells, nothing else.
  const idleWrites = changedAddrs(idle, idleAfter, idle.regs.sp);
  for (const a of idleWrites) {
    assert.ok(
      a === MARIO_CLIMB_LIMIT_A || a === MARIO_CLIMB_LIMIT_B,
      `idle arm wrote outside the climb-limit pair at 0x${a.toString(16)}`,
    );
  }

  console.log(`  EQUAL/crafted: climb arm (A<-0x11 B<-0x22, timer reloaded) and idle arm (A<-0x33 B<-0x44, pair-only) identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: swapped-order and dropped-write twins are CAUGHT", () => {
  const caps = captureDispatches(1, 9000);
  assert.ok(caps.length >= 1, "need a real capture to seed the teeth baits");
  const seed = caps[0];

  // (a) swapped-order: distinct limits (0x11 vs 0x22) so A<-second differs from A<-first.
  const swapBait = craft(seed, { b: 0x11, d: 0x22, input: UP_BIT, timer: 0, preA: 0x00, preB: 0x00 });
  const swapped = contractDiffs(swapBait, brokenSwappedOrder);
  assert.ok(swapped.length > 0, "the swapped-order twin escaped — the gate is worthless");
  assert.ok(
    swapped[0].startsWith(`RAM@0x${MARIO_CLIMB_LIMIT_A.toString(16)}`),
    `expected the swap diff at MARIO_CLIMB_LIMIT_A, got ${swapped[0]}`,
  );

  // (b) dropped-write: the second cell starts at 0x00, the oracle writes 0x22 — the twin leaves it.
  const dropBait = craft(seed, { b: 0x11, d: 0x22, input: 0x00, preA: 0x00, preB: 0x00 });
  const dropped = contractDiffs(dropBait, brokenDroppedWrite);
  assert.ok(dropped.length > 0, "the dropped-write twin escaped — the gate is worthless");
  assert.ok(
    dropped[0].startsWith(`RAM@0x${MARIO_CLIMB_LIMIT_B.toString(16)}`),
    `expected the dropped-write diff at MARIO_CLIMB_LIMIT_B, got ${dropped[0]}`,
  );

  console.log(`  TEETH: swapped-order caught (${swapped[0]}); dropped-write caught (${dropped[0]})`);
});
