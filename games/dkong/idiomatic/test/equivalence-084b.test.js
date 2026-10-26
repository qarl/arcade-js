// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearSubstateWhenTimerExpires (ROM 0x084b) — the timed
 * sub-state gate that clears GAME_SUBSTATE once the two-level countdown expires.
 *
 * loc_084b reads NO memory of its own: its entire observable behaviour is a function
 * of just TWO bytes, SUBSTATE_TIMER_LO (0x6008) and SUBSTATE_TIMER (0x6009), ticked
 * through the rst-0x20 skip helper, plus one conditional write to GAME_SUBSTATE
 * (0x600A). (Probed: on synthetic entries the oracle writes only {0x6008, 0x6009,
 * 0x600A} outside the stack.) It is a VOID handler — nothing downstream consumes a
 * return; the `rst 0x20` skip only unwinds the return address the rst itself pushed,
 * so control lands back in the dispatcher on both branches. Everything else the oracle
 * touches (SP, the pushed 0x084c return byte, HL/A/F) is the Z80 caller-skip mechanism
 * the direct-call model replaces — the pushed byte lands in STACK_SCRATCH (real SP at
 * dispatch is 0x6bee/0x6bf0, deep in that dead region), so it is excluded from the
 * contract, which is therefore RAM (minus the stack scratch below the entry SP). That leaves the strongest
 * gate available:
 *
 *   1. EQUAL (exhaustive) — clearSubstateWhenTimerExpires == oracle over ALL 65,536
 *      (lo,hi) combos of (0x6008, 0x6009), compared on RAM (minus the stack scratch below the entry SP).
 *      GAME_SUBSTATE is seeded to a nonzero sentinel so the clear-to-0 is observable
 *      (loc_084b never reads it, so the branch logic is unaffected). 256×256 is the
 *      complete input space — a proof, not a sample.
 *
 *   2. TEETH (exhaustive) — two deliberately-broken twins the sweep MUST catch, both
 *      on the memory half of the contract:
 *        (a) clear-on-any-underflow — clears 0x600A whenever the LOW prescaler
 *            underflows, ignoring whether the high half also expired. It ticks the
 *            same 0x6008/0x6009 as the oracle, so only the 0x600A byte diverges, and
 *            only on the lo==1, hi!=1 edge. Proves the sweep reaches that edge and the
 *            RAM diff sees the wrong clear.
 *        (b) never-clears — runs the countdown but never writes 0x600A. Caught on the
 *            full-expire case (lo==1, hi==1), where the oracle clears and it does not.
 *
 *   3. REALISM (captured dispatches) — hook 0x084b in a real attract run, clone the
 *      machine at each true dispatch (fired from game-state-1 sub-state 7), and confirm
 *      the candidate reproduces the oracle's RAM on every real state the game produces.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-084b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_084b as oracle } from "../../translated/loc_084b.js";
import { clearSubstateWhenTimerExpires } from "../clearSubstateWhenTimerExpires.js";
import { tickSubstatePrescaler } from "../tickSubstatePrescaler.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { SUBSTATE_TIMER_LO, SUBSTATE_TIMER, GAME_SUBSTATE, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x084b;
const SUBSTATE_SENTINEL = 0xaa;
// The oracle's `rst 0x20` pushes 0x084c at SP-2 and its callees pop it back; point SP into
// work RAM so those stack reads stay valid (never I/O). The pushed bytes land in
// STACK_SCRATCH, which the contract excludes, so they never affect the compared state.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

/**
 * First differing RAM byte between two machines, EXCLUDING the stack scratch below the entry SP, or null.
 * The oracle writes its `rst` return address into the stack region; the direct-call
 * candidate does not, so that region is dead scratch and outside the contract.
 */
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

/**
 * Run the oracle and the candidate on two FRESH clones of `entry` (the routine WRITES
 * memory, so a clone per side — docs/decompiler-pipeline: only a pure read-only leaf may reuse one) and
 * diff RAM minus the stack scratch below the entry SP. loc_084b returns nothing consumed, so RAM is the whole
 * contract.
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return ramDiffNoStack(a, b, entry.regs.sp);
}

function makeEntry(base, lo, hi) {
  const e = base.clone();
  e.mem.write8(SUBSTATE_TIMER_LO, lo);
  e.mem.write8(SUBSTATE_TIMER, hi);
  e.mem.write8(GAME_SUBSTATE, SUBSTATE_SENTINEL);
  e.regs.sp = SAFE_SP;
  return e;
}

/**
 * Sweep a candidate against the oracle over all 65,536 (lo,hi) timer-byte combos.
 * Returns the first RAM mismatch (minus stack), or null, plus the count compared.
 */
function sweep(base, candidate) {
  let count = 0;
  for (let lo = 0; lo < 256; lo++) {
    for (let hi = 0; hi < 256; hi++) {
      const ram = runPair(makeEntry(base, lo, hi), candidate);
      count++;
      if (ram) return { mismatch: { lo, hi, ram }, count };
    }
  }
  return { mismatch: null, count };
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): clearSubstateWhenTimerExpires == oracle over all 65,536 (0x6008,0x6009) combos", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, clearSubstateWhenTimerExpires);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `RAM diverges at 0x6008=${hx(mismatch.lo)} 0x6009=${hx(mismatch.hi)}: ` +
        `0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`,
  );
  assert.equal(count, 256 * 256, "must have compared all 65,536 (lo,hi) combos");
  console.log(`  EQUAL/exhaustive: ${count} (lo,hi) combos — RAM (minus stack) identical to the oracle`);
});

// -- 2. TEETH (exhaustive) ----------------------------------------------------

function brokenClearOnAnyUnderflow(m) {
  const { mem } = m;
  const remaining = (mem.read8(SUBSTATE_TIMER_LO) - 1) & 0xff;
  mem.write8(SUBSTATE_TIMER_LO, remaining);
  if (remaining !== 0) return;
  tickSubstateTimer(m); // still ticks the high half — 0x6009 stays correct
  mem.write8(GAME_SUBSTATE, 0x00); // BUG: should clear only when the high half ALSO expired
}

/** BUG: runs the countdown but never clears GAME_SUBSTATE — the timed wait never ends. */
function brokenNeverClears(m) {
  tickSubstatePrescaler(m);
}

test("TEETH (exhaustive): the clear-on-any-underflow twin is CAUGHT (wrong-condition clear)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenClearOnAnyUnderflow);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a wrong-condition clear of 0x600A — worthless");
  assert.equal(mismatch.ram.addr, GAME_SUBSTATE, "the wrong clear must be caught at GAME_SUBSTATE (0x600A)");
  console.log(
    `  TEETH/condition: caught after ${count} combos at 0x6008=${hx(mismatch.lo)} 0x6009=${hx(mismatch.hi)} ` +
      `(0x600A ${mismatch.ram.a}->${mismatch.ram.b})`,
  );
});

test("TEETH (exhaustive): the never-clears twin is CAUGHT (missing clear)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch } = sweep(base, brokenNeverClears);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a missing clear of 0x600A — worthless");
  assert.equal(mismatch.ram.addr, GAME_SUBSTATE, "the missing clear must be caught at GAME_SUBSTATE (0x600A)");
  console.log(`  TEETH/missing: caught — candidate left 0x600A at ${hx(mismatch.ram.b)} where the oracle cleared it to 0`);
});

// -- 3. REALISM (captured dispatches) -----------------------------------------

/**
 * Hook 0x084b in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper clones the entry state, then runs the oracle so the host game proceeds
 * undisturbed to a clean stop. 0x084b is game-state-1 sub-state 7; it first dispatches
 * around frame ~2000 of attract, so run long enough to reach it.
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

test("REALISM: real captured 0x084b dispatches — candidate matches oracle RAM", () => {
  const caps = captureDispatches(128, 4200);
  assert.ok(caps.length >= 1, "expected at least one real 0x084b dispatch during attract");

  for (const cap of caps) {
    const lo = cap.mem.read8(SUBSTATE_TIMER_LO);
    const hi = cap.mem.read8(SUBSTATE_TIMER);
    const ram = runPair(cap, clearSubstateWhenTimerExpires);
    assert.equal(
      ram,
      null,
      ram &&
        `RAM diverges on real dispatch (0x6008 in=${hx(lo)} 0x6009 in=${hx(hi)}) at ` +
          `0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`,
    );
  }
  console.log(`  REALISM: ${caps.length} real 0x084b dispatches — RAM (minus stack) == oracle`);
});
