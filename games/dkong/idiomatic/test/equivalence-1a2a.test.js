// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for advanceSubstateWhenGrounded (ROM 0x1a2a) — the idx3 WAIT+EXIT
 * step of the bonus-expired sub-state machine.
 *
 * loc_1a2a's entire memory+control behaviour is a total function of TWO bytes:
 *   - MARIO_AIRBORNE (0x6216) selects the branch: != 0 -> hold (return true, no RAM
 *     write); == 0 -> run the shared tail (0x19d2) and caller-skip (return false).
 *   - GAME_SUBSTATE (0x600A) is the byte that grounded tail increments (mod 256).
 * SUBSTATE_TIMER (0x6009) is written to 0x40 unconditionally on the grounded arm.
 * Everything else the oracle touches is the Z80 return mechanism (SP/PC + a pushed
 * return address) the direct-call model drops — it lands only in STACK_SCRATCH, which
 * is excluded from the contract. So the contract is: RAM (minus the stack scratch below the entry SP) + the
 * boolean caller-skip return. That makes the strongest gate available:
 *
 *   1. EQUAL (exhaustive) — advanceSubstateWhenGrounded == oracle over all 65,536
 *      (airborne x substate) combos, compared on RAM (minus the stack scratch below the entry SP) AND the
 *      boolean return. 65,536 is the complete input space — a proof, not a sample.
 *      Each entry seeds SUBSTATE_TIMER with a 0x99 sentinel so a dropped re-arm would
 *      show in the RAM diff.
 *
 *   2. TEETH (two twins, complementary — one per half of the contract):
 *        (a) always-advance — drops the airborne gate (advances + returns false even
 *            when airborne). Caught by the RAM diff (advances GAME_SUBSTATE when the
 *            oracle wrote nothing). Proves the airborne gate is checked.
 *        (b) inverted-return — does the correct RAM work but returns the wrong
 *            boolean. RAM is identical, so it is caught ONLY by the return check —
 *            proving the caller-skip signal (a live-out RAM alone does not cover) has
 *            teeth.
 *
 *   3. REALISM (crafted entries) — 0x1a2a is unreachable in attract (BONUS_EXPIRED_STEP
 *      never reaches idx3), so real states are captured at its PARENT router 0x1a07
 *      (which fires every cascade frame), then poked to force each branch identically
 *      on both sides. Confirms the rewrite matches the oracle on states the game really
 *      produces.
 *
 * A FRESH clone per side everywhere: the routine WRITES memory on the grounded arm, so
 * a reused machine would carry the previous advance forward (docs/decompiler-pipeline: only a pure
 * read-only leaf may reuse one).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a2a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a2a as oracle } from "../../translated/loc_1a2a.js";
import { loc_1a07 } from "../../translated/loc_1a07.js";
import { advanceSubstateWhenGrounded } from "../advanceSubstateWhenGrounded.js";
import { advanceSubstateAndArmTimer } from "../advanceSubstateAndArmTimer.js";
import {
  MARIO_AIRBORNE,
  GAME_SUBSTATE,
  SUBSTATE_TIMER,
  BONUS_EXPIRED_STEP,
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

const TARGET = 0x1a2a;
const PARENT = 0x1a07;
// The oracle's grounded arm does `pop hl` then `jp 0x19d2` (whose tail ends in `ret`),
// both moving SP. Point SP into the dead stack scratch so those reads/writes land in
// the excluded region and stay well-defined (never I/O). SP is not in the contract.
const SAFE_SP = 0x6bf8;
// A value the routine NEVER produces for SUBSTATE_TIMER (grounded always writes 0x40),
// seeded into each entry so a dropped re-arm would be visible to the RAM diff.
const TIMER_SENTINEL = 0x99;
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
 * Run the oracle and a candidate on two FRESH clones of `entry` and return the
 * contract comparison: the first non-stack RAM diff (or null) and both boolean
 * returns. A fresh clone per side because the routine writes memory.
 */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  const retA = oracle(a);
  const retB = candidate(b);
  return { ram: ramDiffNoStack(a, b, entry.regs.sp), retA, retB };
}

/** A synthetic entry: this machine with the two behaviour-relevant bytes set, a
 *  sentinel timer, and a safe stack. */
function makeEntry(base, airborne, substate) {
  const e = base.clone();
  e.mem.write8(MARIO_AIRBORNE, airborne);
  e.mem.write8(GAME_SUBSTATE, substate);
  e.mem.write8(SUBSTATE_TIMER, TIMER_SENTINEL);
  e.regs.sp = SAFE_SP;
  return e;
}

/**
 * Sweep a candidate against the oracle over airborne x substate. A "mismatch" is a
 * non-stack RAM difference OR a differing boolean return. Returns the first mismatch
 * (with which half caught it) or null, and the count compared.
 */
function sweep(base, candidate, airborneVals, substateVals) {
  let count = 0;
  for (const airborne of airborneVals) {
    for (const substate of substateVals) {
      const { ram, retA, retB } = runPair(makeEntry(base, airborne, substate), candidate);
      count++;
      if (ram || retA !== retB) {
        return { mismatch: { airborne, substate, ram, retA, retB }, count };
      }
    }
  }
  return { mismatch: null, count };
}

const ALL = Array.from({ length: 256 }, (_, i) => i);

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): advanceSubstateWhenGrounded == oracle over all 65,536 (airborne x substate) combos", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, advanceSubstateWhenGrounded, ALL, ALL);
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at airborne=${hx(mismatch.airborne)} substate=${hx(mismatch.substate)}: ` +
        (mismatch.ram
          ? `RAM diverges at 0x${(mismatch.ram.addr ?? 0).toString(16)} (${mismatch.ram.a}->${mismatch.ram.b})`
          : `return diverges oracle=${mismatch.retA} cand=${mismatch.retB}`),
  );
  assert.equal(count, 256 * 256, "must have compared the full 65,536-combo grid");
  console.log(`  EQUAL/exhaustive: ${count} (airborne,substate) combos — RAM+return identical to the oracle`);
});

// -- 2. TEETH -----------------------------------------------------------------

/** BUG: drops the airborne gate — always advances and returns false, even airborne.
 *  Caught by the RAM diff on airborne inputs (advances when the oracle wrote nothing). */
function brokenAlwaysAdvance(m) {
  advanceSubstateAndArmTimer(m);
  return false;
}

/** BUG: correct RAM work, but returns the INVERTED caller-skip signal. RAM is
 *  identical to the oracle, so only the return check can catch it. */
function brokenInvertedReturn(m) {
  const { mem } = m;
  if (mem.read8(MARIO_AIRBORNE) !== 0) return false; // should be true
  advanceSubstateAndArmTimer(m);
  return true; // should be false
}

test("TEETH: the always-advance twin is CAUGHT by the RAM diff (airborne gate has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenAlwaysAdvance, ALL, ALL);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch a dropped airborne gate — the check is worthless");
  assert.ok(mismatch.ram, "the always-advance twin must be caught by the RAM diff (an unexpected GAME_SUBSTATE advance)");
  assert.notEqual(mismatch.airborne, 0, "must be caught on an AIRBORNE input, where the oracle writes nothing");
  console.log(
    `  TEETH/gate: caught after ${count} combos at airborne=${hx(mismatch.airborne)} — ` +
      `RAM diverges at 0x${(mismatch.ram.addr ?? 0).toString(16)}`,
  );
});

test("TEETH: the inverted-return twin is CAUGHT by the return check (caller-skip signal has teeth)", () => {
  const base = new Machine(ROM).clone();
  const { mismatch, count } = sweep(base, brokenInvertedReturn, ALL, ALL);
  assert.notEqual(mismatch, null, "the sweep FAILED to catch an inverted caller-skip return — the check is worthless");
  assert.equal(mismatch.ram, null, "the inverted-return twin has identical RAM — it must be caught by the RETURN check, not RAM");
  assert.notEqual(mismatch.retA, mismatch.retB, "the catch must be the differing boolean return");
  console.log(
    `  TEETH/return: caught after ${count} combos at airborne=${hx(mismatch.airborne)} ` +
      `substate=${hx(mismatch.substate)} — oracle=${mismatch.retA} twin=${mismatch.retB}`,
  );
});

// -- 3. REALISM (crafted entries) ---------------------------------------------

/**
 * Hook the PARENT router 0x1a07 in a real attract run and clone the machine at up to
 * K real dispatches — realistic mid-cascade states 0x1a2a would be invoked with. The
 * wrapper clones then delegates to the oracle router so the host proceeds to a clean
 * stop. (0x1a2a itself is never dispatched in attract: BONUS_EXPIRED_STEP stays < idx3.)
 */
function captureParentDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[PARENT, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return loc_1a07(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

test("REALISM: real captured cascade states (via parent 0x1a07), both branches — rewrite matches oracle", () => {
  const caps = captureParentDispatches(96, 4000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1a07 dispatch during attract");

  let checked = 0;
  for (const cap of caps) {
    // Present this as a legitimate idx3 reach: force BONUS_EXPIRED_STEP = idx3 and a
    // safe stack, identically on both sides. loc_1a2a itself does not read 0x6386, but
    // this keeps the crafted state faithful to how 0x1a2a is actually entered.
    const staged = cap.clone();
    staged.mem.write8(BONUS_EXPIRED_STEP, 3);
    staged.regs.sp = SAFE_SP;

    // Exercise BOTH branches on this real state by poking the one selector byte.
    for (const airborne of [0x00, 0x01]) {
      const entry = staged.clone();
      entry.mem.write8(MARIO_AIRBORNE, airborne);
      const before = entry.mem.read8(GAME_SUBSTATE);
      const { ram, retA, retB } = runPair(entry, advanceSubstateWhenGrounded);
      assert.equal(
        ram,
        null,
        ram &&
          `RAM diverges on real state (airborne=${hx(airborne)}, substate in=${hx(before)}) at ` +
            `0x${(ram.addr ?? 0).toString(16)} (${ram.a}->${ram.b})`,
      );
      assert.equal(retA, retB, `return diverges on real state (airborne=${hx(airborne)}): oracle=${retA} cand=${retB}`);
      checked++;
    }
  }
  console.log(`  REALISM: ${caps.length} real cascade states x 2 branches = ${checked} checks — RAM+return == oracle`);
});
