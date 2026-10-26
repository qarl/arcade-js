// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runRivetBoardInterludeFrame (ROM 0x1641) — the fall-through arm of dispatchBoardClearedInterlude's
 * board-advance dispatcher (GAME_SUBSTATE 0x600A == 0x16). It runs the effect-sprite state
 * machine one frame (sub_1dbd, a router on EFFECT_STATE 0x6340) and then dispatches the
 * board-render sequence step (dispatchRivetBoardInterludeStep: `ld a,(0x6388)` -> rst 0x28 @ ROM 0x1648).
 *
 * runRivetBoardInterludeFrame is NOT reached in plain attract — a board is never completed there — so it is
 * validated by MEMORY-equivalence against the frozen oracle (RAM − the stack scratch below the entry SP; never
 * the full register file, never cycles, never SP/pc: the idiomatic effect-machine state-1
 * arm leaves SP/pc where the oracle's return chain does not, and no caller reads them),
 * with a FRESH clone per case and CRAFTED entries (doc-06: a real state + a surgical poke):
 *
 *   1. FULL-HANDLER (crafted cross-product) — take a real attract base captured at a live
 *      0x1dbd dispatch (so EFFECT_PARAM_PTR 0x6343 is a valid pointer the state-1 arm can
 *      deref), poke the effect state {0,1,2} and the render step {0..5} to every
 *      combination identically on both sides, and run the ORACLE runRivetBoardInterludeFrame on one clone and
 *      runRivetBoardInterludeFrame on another. The FULL oracle handlers — the effect machine AND the
 *      board-render arm — run on BOTH sides, so a wrong order, a dropped call, or a live
 *      register/flag handoff surfaces as divergent RAM. Proven non-vacuous: every
 *      combination mutates game-visible RAM vs the untouched base.
 *
 *   2. TEETH — two deliberately-broken twins, each caught by the cross-product:
 *      (a) drop the effect-machine call (only the render dispatch runs) — caught on the
 *          states {1,2} where the effect machine mutates RAM (its state advance at 0x6340);
 *      (b) drop the render dispatch (only the effect machine runs) — caught on every step,
 *          the board-render arm always mutates RAM.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1641.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1641 as oracle } from "../../translated/loc_1641.js";
import { loc_1dbd as oracleSub1dbd } from "../../translated/loc_1dbd.js";
import { runRivetBoardInterludeFrame } from "../runRivetBoardInterludeFrame.js";
import { dispatchEffectState } from "../dispatchEffectState.js"; // drop-dispatch teeth twin
import { dispatchRivetBoardInterludeStep } from "../dispatchRivetBoardInterludeStep.js"; // drop-effect teeth twin
import { Machine } from "../../machine.js";
import { ORACLE_ROUTINES } from "../../routines.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const STATE = 0x6340; // effect-sprite state machine state (0 idle, 1 arm, 2 countdown)
const STEP = 0x6388;  // board-render sequence step selector (0..5)
const EFFECT_STATES = [0, 1, 2];
const RENDER_STEPS = [0, 1, 2, 3, 4, 5];
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// First game-visible RAM difference between two state dumps, EXCLUDING the dead
// STACK_SCRATCH region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns
// { addr, a, b } or null.
function firstNonStackDiff(da, db, m, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = m.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: da[i], b: db[i] };
  }
  return null;
}

// Catch-all override (duck-typed like the Machine's overrides Map) that runs the frozen handler for
// whatever render-dispatch target was computed (0x17b6 and the step arms). Installed identically on
// both sides; RAM(−stack) stays the comparison (SP/pc already excluded here).
function oracleCatchAll() {
  return {
    has: () => true,
    get: (target) => (mm) => ORACLE_ROUTINES.get(target)(mm),
  };
}

/** Run oracle and a candidate on independent FRESH clones of one crafted entry; diff RAM. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  a.overrides = oracleCatchAll();
  b.overrides = oracleCatchAll();
  oracle(a);
  candidate(b);
  return firstNonStackDiff(a.dumpState(), b.dumpState(), a, entry.regs.sp);
}

/**
 * A real, self-consistent attract base captured AT a live 0x1dbd dispatch whose effect
 * param-block pointer (0x6343/0x6344) points into work RAM — so the crafted state-1 arm
 * (dispatchEffectState -> armScorePopupAndSelectAward -> stageAward300Popup -> stageAwardPopupAtHitObject dereferences it) is a faithful live-in, not
 * a fault. runRivetBoardInterludeFrame is never dispatched in attract; we craft its entry by poking. Delegates
 * to the oracle sub_1dbd so the host run proceeds undisturbed.
 */
function captureBase(maxFrames = 8000) {
  const caps = [];
  const snap = new Map([[0x1dbd, (mm) => {
    const ptr = mm.mem.read8(0x6343) | (mm.mem.read8(0x6344) << 8);
    if (ptr >= 0x6000 && ptr < 0x6c00 && caps.length < 8) caps.push(mm.clone());
    return oracleSub1dbd(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  assert.ok(caps.length, "expected a real 0x1dbd dispatch with a valid 0x6343 param pointer");
  return caps[0].clone(); // clone neutralises the frame machinery (nextNmi/nextBoundary = Infinity)
}

/**
 * Stamp a crafted dispatch entry onto a clone: reset SP to the real DK stack top (0x6C00)
 * and lay a few plausible caller-return words, then poke the effect state and the render
 * step.
 *
 * Three return words, not one: the idiomatic runRivetBoardInterludeFrame reaches the effect handler and the
 * render arm as direct idiomatic→idiomatic calls, so it never pushes the intermediate
 * `call 0x1dbd` return the oracle does. Each of those callees still models its own `ret`
 * for its own equivalence test, so the idiomatic side pops up to TWO return words (the
 * effect-state-2 countdown's `ret` plus the render arm's `ret`) where the oracle balances
 * its own push. Laying three keeps every `ret` on BOTH sides reading a mapped stack cell
 * (never past 0x6C00) while the whole walk stays inside the dead STACK_SCRATCH region —
 * SP/pc diverge and are outside the compare, but the reads must not fault.
 */
function craftEntry(base, state, step) {
  const m = base.clone();
  m.regs.sp = 0x6c00;  // real DK stack top (work RAM grows down from here)
  m.push16(0x4d5e);    // caller-return words, as boot.test.js frames them
  m.push16(0x4d5e);
  m.push16(0x4d5e);
  m.mem.write8(STATE, state);
  m.mem.write8(STEP, step);
  return m;
}

// -- 1. FULL-HANDLER (crafted cross-product) ----------------------------------

test("FULL-HANDLER: runRivetBoardInterludeFrame == oracle over effect-state {0,1,2} × render-step {0..5}", () => {
  const base = captureBase();
  assert.ok(
    craftEntry(base, 0, 0).regs.sp >= STACK_SCRATCH.lo && craftEntry(base, 0, 0).regs.sp < STACK_SCRATCH.hi,
    "crafted entry SP must sit inside STACK_SCRATCH so excluding the region cannot mask a real diff",
  );

  let mismatch = null;
  let mutated = 0;
  let total = 0;
  const seen = new Set();

  for (const state of EFFECT_STATES) {
    for (const step of RENDER_STEPS) {
      total++;
      const entry = craftEntry(base, state, step);
      const before = entry.dumpState();

      const a = entry.clone();
      const b = entry.clone();
      a.overrides = oracleCatchAll();
      b.overrides = oracleCatchAll();
      oracle(a);
      runRivetBoardInterludeFrame(b);

      const bad = firstNonStackDiff(a.dumpState(), b.dumpState(), a, entry.regs.sp);
      if (bad && !mismatch) mismatch = { state, step, bad };
      seen.add(`${state}:${step}`);

      // Non-vacuous: the composition actually mutated game-visible RAM vs the base.
      if (firstNonStackDiff(before, a.dumpState(), a, entry.regs.sp)) mutated++;
    }
  }

  assert.equal(
    mismatch,
    null,
    mismatch && `RAM diverged at ${hx(mismatch.bad.addr)}: oracle=${mismatch.bad.a} cand=${mismatch.bad.b} ` +
      `(effect-state ${mismatch.state}, render-step ${mismatch.step})`,
  );
  assert.equal(seen.size, total, "must have run every combination");
  assert.equal(mutated, total, `every combination must mutate game-visible RAM (replay vacuous otherwise); ${mutated}/${total}`);
  console.log(`  FULL-HANDLER: ${total} combinations (effect {0,1,2} × step {0..5}) — RAM(−stack) identical, all non-vacuous`);
});

// -- 2. TEETH -----------------------------------------------------------------

// Twin (a): drop the effect-machine call — only the render dispatch runs. Misses the
// effect state machine's per-frame work (state advance / countdown / effect sound).
function brokenDropEffect(m) {
  dispatchRivetBoardInterludeStep(m);
}

// Twin (b): drop the render dispatch — only the effect machine runs. Misses the whole
// board-render sequence step (the arm that paints/animates and steps the sequence).
function brokenDropDispatch(m) {
  dispatchEffectState(m);
}

test("TEETH (drop effect machine): CAUGHT on the effect-active states {1,2}", () => {
  const base = captureBase();
  let caughtAt = null;
  for (const state of [1, 2]) {
    for (const step of RENDER_STEPS) {
      const bad = replay(craftEntry(base, state, step), brokenDropEffect);
      if (bad) { caughtAt = { state, step, bad }; break; }
    }
    if (caughtAt) break;
  }
  assert.notEqual(caughtAt, null, "the cross-product FAILED to catch a dropped effect-machine call — it is worthless");
  console.log(`  TEETH/drop-effect: caught at effect-state ${caughtAt.state}, step ${caughtAt.step} — ` +
    `first game-visible diff at ${hx(caughtAt.bad.addr)} (oracle=${caughtAt.bad.a} broken=${caughtAt.bad.b})`);
});

test("TEETH (drop render dispatch): CAUGHT on every render step (effect idle, state 0)", () => {
  const base = captureBase();
  let caughtSteps = 0;
  let example = null;
  for (const step of RENDER_STEPS) {
    // State 0 keeps the effect machine an idle no-op, so the diff is purely the missing
    // board-render arm.
    const bad = replay(craftEntry(base, 0, step), brokenDropDispatch);
    if (bad) { caughtSteps++; if (!example) example = { step, bad }; }
  }
  assert.equal(caughtSteps, RENDER_STEPS.length,
    `the cross-product FAILED to catch a dropped render dispatch on some step (${caughtSteps}/${RENDER_STEPS.length})`);
  console.log(`  TEETH/drop-dispatch: caught on all ${caughtSteps} steps — e.g. step ${example.step} ` +
    `first game-visible diff at ${hx(example.bad.addr)} (oracle=${example.bad.a} broken=${example.bad.b})`);
});
