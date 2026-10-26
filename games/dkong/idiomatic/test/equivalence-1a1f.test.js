// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceBonusExpiredStepWhenDelayExpires (ROM 0x1a1f) — the
 * state-2 (DELAY) handler of the bonus-expired sequence.
 *
 * loc_1a1f's entire observable behaviour is a function of ONE byte, BONUS_EXPIRED_DELAY
 * (0x6387): it decrements it in place and, only when the result is 0, writes the constant
 * 3 to BONUS_EXPIRED_STEP (0x6386). It reads no other memory (0x6386 is written, never
 * read) and calls nothing. It returns nothing its dispatcher consumes — entry_1a07's idx2
 * arm returns a constant true and control lands in loc_197a, which reads no register the
 * handler leaves behind. Everything else the oracle touches (SP via `ret`, PC via the
 * step model, the residual A/HL/F) is the Z80 return mechanism the direct-call model
 * drops; the `ret` only reads (pops) the stack, so nothing lands outside the contract,
 * which is therefore RAM (minus the stack scratch below the entry SP). That admits the strongest gate available:
 *
 *   1. EQUAL (exhaustive) — advanceBonusExpiredStepWhenDelayExpires == oracle over ALL
 *      256 values of BONUS_EXPIRED_DELAY, compared on RAM (minus the stack scratch below the entry SP). 0x6386 is
 *      seeded to a non-3 sentinel so the advance-to-3 is an observable RAM change (the
 *      routine never reads it, so this cannot affect the branch). 256 is the complete
 *      input space — a proof, not a sample.
 *
 *   2. TEETH (exhaustive) — two deliberately-broken twins the sweep MUST catch:
 *        (a) advance-always — advances BONUS_EXPIRED_STEP to 3 every frame, ignoring the
 *            `ret nz` guard. Ticks 0x6387 like the oracle, so only 0x6386 diverges, and
 *            only where remaining != 0 (255 of 256 inputs) — proving the sweep both
 *            reaches that edge and sees the wrong advance.
 *        (b) no-decrement — writes 0x6387 back unchanged (advancing when the ORIGINAL
 *            byte was 0). Diverges at 0x6387 vs the oracle's decrement — proving the
 *            sweep sees a wrong count.
 *
 *   3. CRAFTED REALISM — loc_1a1f is never dispatched in attract (BONUS never expires
 *      there), so its dispatcher 0x1A07 is captured from a real attract run (it fires
 *      916×/1500 frames, always at step 0) and each captured machine is nudged into
 *      state 2 — 0x6386 := 2 with a spread of 0x6387 values — IDENTICALLY on both sides,
 *      confirming the candidate reproduces the oracle's RAM on realistic surrounding RAM.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a1f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a1f as oracle } from "../../translated/loc_1a1f.js";
import { loc_1a07 as dispatcherOracle } from "../../translated/loc_1a07.js";
import { advanceBonusExpiredStepWhenDelayExpires } from "../advanceBonusExpiredStepWhenDelayExpires.js";
import { BONUS_EXPIRED_DELAY, BONUS_EXPIRED_STEP, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1a1f;
const DISPATCHER = 0x1a07;
const STATE_2 = 0x02; // BONUS_EXPIRED_STEP value at which idx2 (this handler) is dispatched.
// Sentinel parked in BONUS_EXPIRED_STEP so the advance-to-3 is a visible RAM change
// (loc_1a1f never reads 0x6386, so its value cannot affect the branch). STATE_2 doubles
// as the realistic sentinel — it is the step value while this handler runs.
const STEP_SENTINEL = STATE_2;
// The oracle's trailing `ret` pops the stack; point SP into work RAM so that read stays
// valid (never I/O). It only reads, and lands in STACK_SCRATCH, excluded from the contract.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

function ramDiffNoStack(mA, mB, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const a = mA.dumpState();
  const b = mB.dumpState();
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = mA.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { offset: i, addr, a: a[i], b: b[i] };
  }
  return null;
}

/** Oracle and candidate on FRESH clones of `entry` (a writer needs one per side); diff RAM minus stack scratch. */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return ramDiffNoStack(a, b, entry.regs.sp);
}

/** A synthetic entry: `base` with the delay byte set, a sentinel step, and a safe stack. */
function makeEntry(base, delay) {
  const e = base.clone();
  e.mem.write8(BONUS_EXPIRED_DELAY, delay);
  e.mem.write8(BONUS_EXPIRED_STEP, STEP_SENTINEL);
  e.regs.sp = SAFE_SP;
  return e;
}

function sweep(base, candidate) {
  let count = 0;
  for (let delay = 0; delay < 256; delay++) {
    const ram = runPair(makeEntry(base, delay), candidate);
    count++;
    if (ram) return { mismatch: { delay, ram }, count };
  }
  return { mismatch: null, count };
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): advanceBonusExpiredStepWhenDelayExpires == oracle over all 256 (0x6387) values", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, advanceBonusExpiredStepWhenDelayExpires);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `RAM diverges at 0x6387=${hx(mismatch.delay)}: ` +
        `0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`,
  );
  assert.equal(count, 256, "must have compared all 256 delay values");
  console.log(`  EQUAL/exhaustive: ${count} delay values — RAM (minus stack) identical to the oracle`);
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

/**
 * BUG: advances BONUS_EXPIRED_STEP to 3 on EVERY frame, ignoring the `ret nz` guard.
 * It ticks 0x6387 exactly like the oracle, so only 0x6386 diverges — and only where
 * remaining != 0, i.e. the sequence should have stayed parked in state 2.
 */
function brokenAdvanceAlways(m) {
  const { mem } = m;
  const remaining = (mem.read8(BONUS_EXPIRED_DELAY) - 1) & 0xff;
  mem.write8(BONUS_EXPIRED_DELAY, remaining);
  mem.write8(BONUS_EXPIRED_STEP, 0x03); // BUG: should only advance when remaining == 0
}

/**
 * BUG: takes the branch on the correctly-decremented value (so the advance matches the
 * oracle) but stores the byte back WITHOUT the decrement. Isolates the divergence purely
 * to 0x6387 against the oracle's decrement on every value.
 */
function brokenNoDecrement(m) {
  const { mem } = m;
  const cur = mem.read8(BONUS_EXPIRED_DELAY);
  const remaining = (cur - 1) & 0xff;
  mem.write8(BONUS_EXPIRED_DELAY, cur); // BUG: stores the pre-decrement value
  if (remaining !== 0) return;
  mem.write8(BONUS_EXPIRED_STEP, 0x03);
}

test("TEETH (exhaustive): the advance-always twin is CAUGHT (missing ret-nz guard)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenAdvanceAlways);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an unconditional advance of 0x6386 — worthless");
  assert.equal(mismatch.ram.addr, BONUS_EXPIRED_STEP, "the wrong advance must be caught at BONUS_EXPIRED_STEP (0x6386)");
  console.log(
    `  TEETH/advance-always: caught after ${count} combos at 0x6387=${hx(mismatch.delay)} ` +
      `(0x6386 ${mismatch.ram.a}->${mismatch.ram.b})`,
  );
});

test("TEETH (exhaustive): the no-decrement twin is CAUGHT (wrong count)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenNoDecrement);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a missing decrement of 0x6387 — worthless");
  assert.equal(mismatch.ram.addr, BONUS_EXPIRED_DELAY, "the missing decrement must be caught at BONUS_EXPIRED_DELAY (0x6387)");
  console.log(`  TEETH/no-decrement: caught at 0x6387 (oracle ${hx(mismatch.ram.a)} vs broken ${hx(mismatch.ram.b)})`);
});

// -- 3. CRAFTED REALISM (real dispatcher states nudged into state 2) -----------

/**
 * Hook the dispatcher 0x1A07 in a real attract run and clone the machine at up to K real
 * dispatches. loc_1a1f itself is never reached in attract (BONUS never expires), so we
 * capture its dispatcher's real states — rich, mid-play work RAM — and force state 2 onto
 * them below. The wrapper clones the entry state, then runs the oracle dispatcher so the
 * host game proceeds undisturbed to a clean stop.
 */
function captureDispatcherStates(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[DISPATCHER, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return dispatcherOracle(mm); // run the frozen dispatcher so the host proceeds normally
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("CRAFTED REALISM: real 0x1A07 states forced to state 2 — candidate matches oracle RAM", () => {
  const caps = captureDispatcherStates(48, 1500);
  assert.ok(caps.length >= 1, "expected at least one real 0x1A07 dispatch during attract");

  // A spread of delay values: the underflow edge (advance) and several parked values.
  const DELAYS = [0x00, 0x01, 0x02, 0x10, 0x80, 0xff];
  let compared = 0;
  for (const cap of caps) {
    for (const delay of DELAYS) {
      const entry = cap.clone();
      entry.mem.write8(BONUS_EXPIRED_STEP, STATE_2);
      entry.mem.write8(BONUS_EXPIRED_DELAY, delay);
      entry.regs.sp = SAFE_SP;
      const ram = runPair(entry, advanceBonusExpiredStepWhenDelayExpires);
      compared++;
      assert.equal(
        ram,
        null,
        ram &&
          `RAM diverges on crafted state (0x6387=${hx(delay)}) at ` +
            `0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`,
      );
    }
  }
  console.log(`  CRAFTED REALISM: ${caps.length} real 0x1A07 states x ${DELAYS.length} delays = ${compared} — RAM == oracle`);
});
