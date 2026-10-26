// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchBonusExpiredStep (ROM 0x1A07) — the rst-0x28 router of
 * the bonus-expired state machine (BONUS_EXPIRED_STEP, 0x6386, values 0..3).
 *
 * The router's whole observable effect is: (a) whatever the dispatched step handler
 * writes to RAM, and (b) the caller-skip boolean it returns to loc_197a. Everything the
 * oracle also touches — the rst-0x28 pointer walk, the pushed table base, each handler's
 * `ret` — is the Z80 stack model the direct-call form drops; it lands only in
 * STACK_SCRATCH (excluded) once SP is parked there. So the contract is RAM (minus
 * STACK_SCRATCH) + the boolean return, NOT the register file / pc / SP.
 *
 *   1. EQUAL (per-step) — dispatchBonusExpiredStep == oracle on RAM (minus the stack scratch below the entry SP)
 *      AND the boolean return, over every step:
 *        - step 0 (idle) and step 1 (INIT): one crafted entry each (they read no input
 *          beyond the step; delay/substate/timer seeded to sentinels so the handler's
 *          constant writes are observable to the RAM diff).
 *        - step 2 (DELAY): the full 0..255 sweep of the delay byte BONUS_EXPIRED_DELAY,
 *          covering both the "still counting" arm and the underflow-to-0 "advance" arm.
 *        - step 3 (WAIT+EXIT): the full 0..255 sweep of MARIO_AIRBORNE, covering the
 *          "hold, return true" arm and the "grounded → advance sub-state, return false"
 *          exit arm.
 *      A FRESH clone per side everywhere — the router writes memory (docs/decompiler-pipeline: only a
 *      pure read-only leaf may reuse a machine).
 *
 *   2. TEETH (two twins, one per half of the contract):
 *        (a) mis-routed step — swaps the step-1 (INIT) and step-2 (DELAY) handlers.
 *            Caught by the RAM diff on a step-1 entry (writes the DELAY handler's bytes,
 *            not INIT's). Proves the step→handler routing is checked.
 *        (b) dropped caller-skip — correct RAM work, but idx3 returns a constant true,
 *            never propagating the grounded-exit false. RAM is identical on the grounded
 *            arm, so ONLY the return check catches it. Proves the caller-skip signal has
 *            teeth.
 *
 *   3. REALISM (captured dispatches) — hook 0x1A07 in a real attract run and clone the
 *      machine at real dispatches. Attract only ever runs step 0 (BONUS never expires),
 *      so those captures validate the idle arm on real states directly; step 1/2/3 are
 *      then crafted from real captured backgrounds (poked identically on both sides),
 *      confirming the unreached arms match the oracle on states the game really produces.
 *
 *   4. FRONTIER — step ≥ 4 is the ROM table's `dw 0x0000` wild-jp frontier; both the
 *      oracle and the rewrite must throw (never reached in play, reproduced faithfully).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a07.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a07 as oracle } from "../../translated/loc_1a07.js";
import { dispatchBonusExpiredStep } from "../dispatchBonusExpiredStep.js";
import { bonusExpiredIdle } from "../bonusExpiredIdle.js";
import { startBonusExpiredDelay } from "../startBonusExpiredDelay.js";
import { advanceBonusExpiredStepWhenDelayExpires } from "../advanceBonusExpiredStepWhenDelayExpires.js";
import { advanceSubstateWhenGrounded } from "../advanceSubstateWhenGrounded.js";
import {
  BONUS_EXPIRED_STEP,
  BONUS_EXPIRED_DELAY,
  MARIO_AIRBORNE,
  GAME_SUBSTATE,
  SUBSTATE_TIMER,
  STACK_SCRATCH,
} from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1a07;
// The oracle walks the rst-0x28 push/pop and each handler's `ret` moves SP. Park SP in
// the dead stack scratch so every such read/write lands in the excluded region and stays
// well-defined (never I/O). SP is not in the contract.
const SAFE_SP = 0x6bf8;
// Values the handlers never leave behind, seeded so a dropped write is visible to the diff:
// step 1 clears the delay to 0, step 3 grounded re-arms the timer to 0x40 and bumps substate.
const DELAY_SENTINEL = 0x99;
const TIMER_SENTINEL = 0x99;
const SUBSTATE_SENTINEL = 0x55;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/**
 * First RAM difference outside the stack scratch below the entry SP between two machines, or null. The stack
 * region is the dropped Z80 stack model's residue and is excluded from the contract.
 */
function ramDiffNoStack(a, b, liveFloor) {
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

/**
 * Run the oracle and a candidate on two FRESH clones of `entry` and return the contract
 * comparison: the first non-stack RAM diff (or null) and both boolean returns.
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  const retA = oracle(a);
  const retB = candidate(b);
  return { ram: ramDiffNoStack(a, b, entry.regs.sp), retA, retB };
}

/**
 * A crafted entry: `base` with the step selected, the behaviour bytes seeded to
 * sentinels (so handler writes are observable), optional delay/airborne overrides for
 * the swept arms, and a safe stack.
 */
function makeEntry(base, step, { delay = DELAY_SENTINEL, airborne = 0x00 } = {}) {
  const e = base.clone();
  e.mem.write8(BONUS_EXPIRED_STEP, step);
  e.mem.write8(BONUS_EXPIRED_DELAY, delay);
  e.mem.write8(MARIO_AIRBORNE, airborne);
  e.mem.write8(GAME_SUBSTATE, SUBSTATE_SENTINEL);
  e.mem.write8(SUBSTATE_TIMER, TIMER_SENTINEL);
  e.regs.sp = SAFE_SP;
  return e;
}

/** Compare candidate vs oracle over a list of crafted entries; first mismatch or null. */
function sweepEntries(entries, candidate) {
  let count = 0;
  for (const { entry, tag } of entries) {
    const { ram, retA, retB } = runPair(entry, candidate);
    count++;
    if (ram || retA !== retB) return { mismatch: { tag, ram, retA, retB }, count };
  }
  return { mismatch: null, count };
}

/** The full crafted entry set: steps 0/1 once, step 2 over all delay bytes, step 3 over
 *  all airborne bytes. */
function allStepEntries(base) {
  const entries = [
    { entry: makeEntry(base, 0), tag: "step0" },
    { entry: makeEntry(base, 1), tag: "step1" },
  ];
  for (let delay = 0; delay < 256; delay++) {
    entries.push({ entry: makeEntry(base, 2, { delay }), tag: `step2/delay=${hx(delay)}` });
  }
  for (let airborne = 0; airborne < 256; airborne++) {
    entries.push({ entry: makeEntry(base, 3, { airborne }), tag: `step3/airborne=${hx(airborne)}` });
  }
  return entries;
}

// -- 1. EQUAL (per-step) ------------------------------------------------------

test("EQUAL (per-step): dispatchBonusExpiredStep == oracle on RAM + return over steps 0..3", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweepEntries(allStepEntries(base), dispatchBonusExpiredStep);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at ${mismatch.tag}: ` +
        (mismatch.ram
          ? `RAM diverges at 0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`
          : `return diverges oracle=${mismatch.retA} cand=${mismatch.retB}`),
  );
  assert.equal(count, 2 + 256 + 256, "must have compared step 0, step 1, all 256 delay bytes, all 256 airborne bytes");
  console.log(`  EQUAL/per-step: ${count} crafted entries (steps 0..3) — RAM+return identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** BUG: routes step 1 to the DELAY handler and step 2 to the INIT handler. On a step-1
 *  entry it writes the DELAY handler's bytes instead of INIT's — caught by the RAM diff. */
function brokenMisroute(m) {
  const step = m.mem.read8(BONUS_EXPIRED_STEP);
  switch (step) {
    case 0: bonusExpiredIdle(m); return true;
    case 1: advanceBonusExpiredStepWhenDelayExpires(m); return true; // BUG: should be INIT
    case 2: startBonusExpiredDelay(m); return true; // BUG: should be DELAY
    case 3: return advanceSubstateWhenGrounded(m);
    default: throw new Error("frontier");
  }
}

/** BUG: correct RAM work, but idx3 always returns true — never propagates the grounded
 *  caller-skip false. RAM is identical on the grounded arm; only the return check catches it. */
function brokenDroppedSkip(m) {
  const step = m.mem.read8(BONUS_EXPIRED_STEP);
  switch (step) {
    case 0: bonusExpiredIdle(m); return true;
    case 1: startBonusExpiredDelay(m); return true;
    case 2: advanceBonusExpiredStepWhenDelayExpires(m); return true;
    case 3: advanceSubstateWhenGrounded(m); return true; // BUG: drops the caller-skip false
    default: throw new Error("frontier");
  }
}

test("TEETH: the mis-routed-step twin is CAUGHT by the RAM diff (step routing has teeth)", () => {
  const base = new Machine(ROM).clone();
  // A step-1 entry with a non-zero delay so INIT (writes delay=0) and DELAY (writes
  // delay-1) produce visibly different bytes.
  const { ram, retA, retB } = runPair(makeEntry(base, 1, { delay: 0x40 }), brokenMisroute);
  assert.ok(ram, "the mis-routed twin must be caught by the RAM diff on a step-1 entry");
  console.log(
    `  TEETH/routing: caught on step 1 — RAM diverges at 0x${(ram.addr ?? 0).toString(16)} ` +
      `(oracle ${ram.a} vs twin ${ram.b}); returns oracle=${retA} twin=${retB}`,
  );
});

test("TEETH: the dropped-caller-skip twin is CAUGHT by the return check (skip signal has teeth)", () => {
  const base = new Machine(ROM).clone();
  // A step-3 GROUNDED entry (airborne == 0): the oracle advances the sub-state AND returns
  // false; the twin does the same RAM work but returns true.
  const { ram, retA, retB } = runPair(makeEntry(base, 3, { airborne: 0x00 }), brokenDroppedSkip);
  assert.equal(ram, null, "the dropped-skip twin must have identical RAM — it is a RETURN-only defect");
  assert.notEqual(retA, retB, "the dropped-skip twin must be caught by the differing boolean return");
  assert.equal(retA, false, "oracle takes the grounded exit (false) when airborne == 0");
  console.log(`  TEETH/return: caught on step 3 grounded — oracle=${retA} twin=${retB} (RAM identical)`);
});

// -- 3. REALISM (captured dispatches) -----------------------------------------

/**
 * Hook 0x1A07 in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host proceeds to a
 * clean stop. Attract fires this router every cascade frame, always at step 0
 * (BONUS never expires in attract), so these are real idle-arm states.
 */
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

test("REALISM: real captured 0x1A07 dispatches (idle arm) + crafted steps 1..3 on real backgrounds", () => {
  const caps = captureDispatches(64, 3000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1A07 dispatch during attract");

  let idleChecks = 0;
  let allStep0 = true;
  for (const cap of caps) {
    if (cap.mem.read8(BONUS_EXPIRED_STEP) !== 0) allStep0 = false;
    // Real state as-is (park SP in scratch so the oracle's rst/ret residue is excluded).
    const entry = cap.clone();
    entry.regs.sp = SAFE_SP;
    const { ram, retA, retB } = runPair(entry, dispatchBonusExpiredStep);
    assert.equal(ram, null, ram && `idle-arm RAM diverges at 0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`);
    assert.equal(retA, retB, `idle-arm return diverges oracle=${retA} cand=${retB}`);
    idleChecks++;
  }
  assert.ok(allStep0, "attract is expected to hold BONUS_EXPIRED_STEP at 0 (idle) throughout");

  // Craft steps 1/2/3 from a real captured background, poked identically on both sides.
  let craftedChecks = 0;
  const bg = caps[caps.length - 1];
  const crafted = [
    { entry: makeEntry(bg, 1), tag: "real/step1" },
    { entry: makeEntry(bg, 2, { delay: 0x01 }), tag: "real/step2-underflow" },
    { entry: makeEntry(bg, 2, { delay: 0x05 }), tag: "real/step2-hold" },
    { entry: makeEntry(bg, 3, { airborne: 0x00 }), tag: "real/step3-grounded" },
    { entry: makeEntry(bg, 3, { airborne: 0x01 }), tag: "real/step3-airborne" },
  ];
  const { mismatch } = sweepEntries(crafted, dispatchBonusExpiredStep);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `crafted ${mismatch.tag}: ` +
        (mismatch.ram
          ? `RAM diverges at 0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`
          : `return diverges oracle=${mismatch.retA} cand=${mismatch.retB}`),
  );
  craftedChecks = crafted.length;
  console.log(`  REALISM: ${idleChecks} real idle-arm dispatches + ${craftedChecks} crafted steps 1..3 — RAM+return == oracle`);
});

// -- 4. FRONTIER --------------------------------------------------------------

test("FRONTIER: step >= 4 (dw 0x0000 wild jp) — both oracle and rewrite throw", () => {
  const base = new Machine(ROM).clone();
  const entry = makeEntry(base, 4);

  const oc = entry.clone();
  assert.throws(() => oracle(oc), "oracle must throw on the out-of-range step-4 frontier");

  const cand = entry.clone();
  assert.throws(() => dispatchBonusExpiredStep(cand), "rewrite must throw on the out-of-range step-4 frontier");
  console.log("  FRONTIER: step 4 throws on both sides (non-executing dw 0x0000 frontier reproduced)");
});
