// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for restartAttractDemoAt25m (ROM 0x0763) — the timed game-state-1
 * sub-state reset: on the pass where both halves of the sub-state timer expire, clear the
 * object-insert request (0x63A0) + a paired engine-scratch byte (0x6392), reseed the live
 * context to board 1 / level 1 / one life (0x6227/0x6229/0x6228), then tail into the board
 * builder (buildBoard, ROM 0x0C92). Until the timer expires the pass only ticks it.
 *
 * This is the CYCLE-FREE / memory-equivalence gate (docs/decompiler-pipeline). The routine
 * writes memory through its callees (the two-level timer tick and the whole board build) and
 * the reset carries state, so every case uses a FRESH clone per side and the two are compared
 * on the go-forward contract:
 *
 *     RAM (dumpState) minus the stack scratch below the entry SP.
 *
 * pc and SP are deliberately NOT compared. The oracle models its control flow with the Z80
 * stack: the `rst 0x20` gate does a caller-skip (a double return) on the not-yet-expired
 * path, and the `jp 0x0c92` is a tail-jump whose callee's `ret` returns on this routine's
 * behalf — plus the board builder's own deep call/ret brackets. Every one of those pushes
 * lands inside STACK_SCRATCH, so they are masked by the contract; the direct-call idiomatic
 * layer replaces them with the JS call stack and a boolean early-return. Registers/flags are
 * dead ABI (the dispatcher reads no return value).
 *
 * REACHABILITY. 0x0763 is dispatched on every game-state-1 sub-state pass, so a plain attract
 * run mints hundreds of real dispatches spanning BOTH skip sub-cases (the fast prescaler still
 * counting; the fast prescaler expired but the sub-state counter still counting) AND — a couple
 * of times per attract cycle — the reset+build path where both expire together. Those real
 * captures are the primary gate; crafted entries then preset the object-insert request nonzero
 * so its clear is observable and force the reset path deterministically.
 *
 * Jobs:
 *   1. REACHABILITY — a plain attract run dispatches 0x0763, capturing skip and run entries.
 *   2. EQUAL (captured) — restartAttractDemoAt25m == oracle over RAM − the stack scratch below the entry SP on every real
 *      dispatch; non-vacuous (the run entries genuinely build a board; the mask is load-bearing).
 *   3. EQUAL (crafted) — a run entry with the object-insert request + level preset nonzero
 *      matches the oracle (proving the reseed reproduces), plus a forced skip and a forced run.
 *   4. TEETH — three broken twins, each MUST be caught:
 *        (a) wrong life count (LIVES = 2) — caught at LIVES (0x6228).
 *        (b) dropped level reseed (LEVEL left at its preset) — caught at LEVEL (0x6229). (The
 *            0x6392 / 0x63A0 clears are faithful but redundant — the 25m setup arm re-clears
 *            both — so a load-bearing reseed cell is used for teeth instead.)
 *        (c) gate NOT enforced (body runs on a skip frame) — caught (board build leaks out).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0763.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0763 as oracle } from "../../translated/loc_0763.js";
import { restartAttractDemoAt25m as idiomatic } from "../restartAttractDemoAt25m.js";
import { tickSubstatePrescaler } from "../tickSubstatePrescaler.js";
import { buildBoard } from "../buildBoard.js";
import { Machine } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  BOARD,
  LIVES,
  LEVEL,
  EVENT_REQ_313C,
  SUBSTATE_TIMER_LO,
  SUBSTATE_TIMER,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0763;
const SCRATCH_6392 = 0x6392; // unnamed engine scratch cleared alongside the object-insert request
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First RAM difference between two machines on the go-forward contract: the whole state
 * dump minus the stack scratch below the entry SP (dead scratch — the oracle's caller-skip / tail-jump / board-build
 * brackets push return addresses there while the direct-call idiomatic side does not).
 * dumpState() returns a fresh array per call, so the dead bytes are masked (copied across)
 * before a single diff. Returns {addr,a,b,offset} or null.
 */
function ramDiffMinusStack(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  for (let off = 0; off < a.length; off++) {
    if (dead(ma.stateOffsetToAddr(off))) b[off] = a[off]; // mask dead scratch
  }
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off));
}

/** How many masked-away diffs actually fell in the dead stack region (mask load-bearing?). */
function stackDiffCount(ma, mb, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = ma.dumpState();
  const b = mb.dumpState();
  let n = 0;
  for (let off = 0; off < a.length; off++) {
    if (a[off] !== b[off] && dead(ma.stateOffsetToAddr(off))) n++;
  }
  return n;
}

/** A dispatch is a RUN (reset+build) entry exactly when both timer halves are 1 going in. */
const isRunEntry = (m) => m.mem.read8(SUBSTATE_TIMER_LO) === 1 && m.mem.read8(SUBSTATE_TIMER) === 1;

/** Capture real 0x0763 dispatches during a plain attract run. */
function captureNatural(K, frames = 6000) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < K) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(frames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureNatural(4000) : [];
const RUN_CAPS = CAPS.filter(isRunEntry);
const SKIP_LO = CAPS.filter((m) => m.mem.read8(SUBSTATE_TIMER_LO) !== 1); // fast prescaler still counting
const SKIP_HI = CAPS.filter((m) => m.mem.read8(SUBSTATE_TIMER_LO) === 1 && m.mem.read8(SUBSTATE_TIMER) !== 1); // fast expired, counter still counting

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x0763 is dispatched during attract, spanning skip and run paths", () => {
  assert.ok(CAPS.length > 0, "0x0763 should be dispatched — the game-state-1 sub-state loop calls it");
  assert.ok(RUN_CAPS.length >= 1, `expected at least one reset+build (run) dispatch; got ${RUN_CAPS.length}`);
  assert.ok(SKIP_LO.length >= 1, "expected skip entries with the fast prescaler still counting");
  assert.ok(SKIP_HI.length >= 1, "expected skip entries with the fast prescaler expired but the counter still counting");
  console.log(`  REACHABILITY: ${CAPS.length} dispatches — ${RUN_CAPS.length} run, ${SKIP_LO.length} skip(fast), ${SKIP_HI.length} skip(counter)`);
});

// -- 1. EQUAL (captured) ------------------------------------------------------

test("EQUAL (captured): restartAttractDemoAt25m == oracle over RAM − the stack scratch below the entry SP on every real dispatch", () => {
  assert.ok(CAPS.length >= 1, "expected at least one real 0x0763 dispatch");
  let sawRun = 0, sawSkip = 0;
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    idiomatic(c);
    const d = ramDiffMinusStack(o, c, cap.regs.sp);
    assert.equal(d, null, d && `dispatch (run=${isRunEntry(cap)}): RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
    if (isRunEntry(cap)) sawRun++; else sawSkip++;
  }

  // Non-vacuity on the run path: it really reseeds the context AND builds the board, and the
  // oracle's dead-stack traffic differs from the direct-call side (the mask is load-bearing).
  const run = RUN_CAPS[0];
  const o = run.clone();
  oracle(o);
  assert.equal(o.mem.read8(BOARD), 1, "run path must reseed BOARD = 1 (25m)");
  assert.equal(o.mem.read8(LEVEL), 1, "run path must reseed LEVEL = 1");
  assert.equal(o.mem.read8(LIVES), 1, "run path must reseed LIVES = 1");
  const c = run.clone();
  idiomatic(c);
  assert.ok(stackDiffCount(o, c, run.regs.sp) > 0, "the oracle's stack traffic must differ so the STACK_SCRATCH mask is load-bearing");

  console.log(`  EQUAL/captured: ${CAPS.length} real dispatches identical (${sawRun} run, ${sawSkip} skip)`);
});

// -- 2. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): reset path with the object-insert request preset, plus forced skip/run", () => {
  // A run entry with EVENT_REQ_313C, the paired scratch, and LEVEL preset nonzero — proves the
  // clears + the level reseed reproduce the oracle byte-for-byte.
  const run = RUN_CAPS[0];
  {
    const o = run.clone();
    const c = run.clone();
    o.mem.write8(EVENT_REQ_313C, 0x55); c.mem.write8(EVENT_REQ_313C, 0x55);
    o.mem.write8(SCRATCH_6392, 0x77);   c.mem.write8(SCRATCH_6392, 0x77);
    o.mem.write8(LEVEL, 9);             c.mem.write8(LEVEL, 9);
    oracle(o);
    idiomatic(c);
    const d = ramDiffMinusStack(o, c, run.regs.sp);
    assert.equal(d, null, d && `preset-reset run: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
    assert.equal(o.mem.read8(EVENT_REQ_313C), 0, "oracle must clear the object-insert request to 0");
    assert.equal(o.mem.read8(SCRATCH_6392), 0, "oracle must clear the paired scratch to 0");
    assert.equal(o.mem.read8(LEVEL), 1, "oracle must reseed LEVEL to 1");
  }

  // Forced RUN: take a skip entry and force both timer halves to 1 identically on both sides.
  {
    const base = (SKIP_LO[0] ?? CAPS[0]);
    const o = base.clone(); const c = base.clone();
    for (const m of [o, c]) { m.mem.write8(SUBSTATE_TIMER_LO, 1); m.mem.write8(SUBSTATE_TIMER, 1); }
    oracle(o); idiomatic(c);
    assert.equal(o.mem.read8(BOARD), 1, "forced-run oracle must reseed BOARD = 1");
    const d = ramDiffMinusStack(o, c, base.regs.sp);
    assert.equal(d, null, d && `forced run: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }

  // Forced SKIP: force the fast prescaler above 1 so the pass only ticks the timer.
  {
    const base = (RUN_CAPS[0] ?? CAPS[0]);
    const o = base.clone(); const c = base.clone();
    for (const m of [o, c]) { m.mem.write8(SUBSTATE_TIMER_LO, 5); }
    oracle(o); idiomatic(c);
    // The skip path must NOT build a board: BOARD is untouched relative to entry.
    assert.equal(o.mem.read8(BOARD), base.mem.read8(BOARD), "forced-skip oracle must not reseed BOARD");
    const d = ramDiffMinusStack(o, c, base.regs.sp);
    assert.equal(d, null, d && `forced skip: RAM diff at ${hx(d.addr ?? 0)} oracle=${d.a} idiomatic=${d.b}`);
  }

  console.log("  EQUAL/crafted: preset-clear run, forced run, forced skip — all identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin (a): reseeds LIVES to 2 instead of 1 (wrong life count). */
function brokenLives(m) {
  const { mem } = m;
  if (!tickSubstatePrescaler(m)) return;
  mem.write8(SCRATCH_6392, 0);
  mem.write8(EVENT_REQ_313C, 0);
  mem.write8(BOARD, 1);
  mem.write8(LEVEL, 1);
  mem.write8(LIVES, 2); // BUG: one life -> two
  buildBoard(m);
}

/** Broken twin (b): drops the level reseed (a load-bearing write the builder does not redo). */
function brokenDropLevel(m) {
  const { mem } = m;
  if (!tickSubstatePrescaler(m)) return;
  mem.write8(SCRATCH_6392, 0);
  mem.write8(EVENT_REQ_313C, 0);
  mem.write8(BOARD, 1);
  // BUG: no `write8(LEVEL, 1)` — the preset level survives
  mem.write8(LIVES, 1);
  buildBoard(m);
}

/** Broken twin (c): ticks the timer identically but ignores the gate and always runs the body. */
function brokenNoGate(m) {
  const { mem } = m;
  tickSubstatePrescaler(m); // same timer side effect as the oracle's rst 0x20 ...
  // BUG: no `if (!...) return;` — the reset+build runs even when the timer has not expired.
  mem.write8(SCRATCH_6392, 0);
  mem.write8(EVENT_REQ_313C, 0);
  mem.write8(BOARD, 1);
  mem.write8(LEVEL, 1);
  mem.write8(LIVES, 1);
  buildBoard(m);
}

test("TEETH: wrong-life, dropped-level, and gate-not-enforced twins are all CAUGHT", () => {
  // (a) wrong life count — on a run entry, caught at LIVES.
  {
    const run = RUN_CAPS[0];
    const o = run.clone(); const c = run.clone();
    oracle(o); brokenLives(c);
    const d = ramDiffMinusStack(o, c, run.regs.sp);
    assert.notEqual(d, null, "the wrong-life twin escaped — the gate is worthless");
    assert.equal(d.addr, LIVES, `expected the life diff at ${hx(LIVES)}, got ${hx(d.addr ?? 0)}`);
  }

  // (b) dropped level reseed — preset LEVEL nonzero so the drop shows, caught at LEVEL.
  {
    const run = RUN_CAPS[0];
    const o = run.clone(); const c = run.clone();
    o.mem.write8(LEVEL, 7); c.mem.write8(LEVEL, 7);
    oracle(o); brokenDropLevel(c);
    const d = ramDiffMinusStack(o, c, run.regs.sp);
    assert.notEqual(d, null, "the dropped-level-reseed twin escaped — the gate is worthless");
    assert.equal(d.addr, LEVEL, `expected the level diff at ${hx(LEVEL)}, got ${hx(d.addr ?? 0)}`);
  }

  // (c) gate not enforced — on a real SKIP entry the body must NOT run; the twin builds a board.
  {
    const skip = SKIP_LO[0];
    const o = skip.clone(); const c = skip.clone();
    oracle(o); brokenNoGate(c);
    const d = ramDiffMinusStack(o, c, skip.regs.sp);
    assert.notEqual(d, null, "the gate-not-enforced twin escaped — the timer gate is untested");
  }

  console.log("  TEETH: wrong-life (0x6228), dropped-level (0x6229), and gate-not-enforced twins all caught");
});
