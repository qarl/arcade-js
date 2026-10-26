// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for startBonusExpiredDelay (ROM 0x1A15) — the INIT step (idx1) of the
 * bonus-expired death sequence: clear BONUS_EXPIRED_DELAY (0x6387) to 0, advance
 * BONUS_EXPIRED_STEP (0x6386) from 1 to 2.
 *
 * loc_1a15 READS no memory and no register — it writes two constants (0x6387 ← 0,
 * 0x6386 ← 2) and calls nothing. Its behaviour is therefore INPUT-INDEPENDENT: a single
 * entry exercises the whole routine, and its correctness on any state is its correctness
 * on every state. So it is validated by running it directly on many real full-RAM
 * backgrounds and against the oracle, with the two output bytes seeded to SENTINELS so
 * each write is observable:
 *
 *   1. EQUAL (fresh sentinel entry) — startBonusExpiredDelay == oracle on RAM −
 *      STACK_SCRATCH, and the oracle's own result IS the documented effect (0x6386 → 2,
 *      0x6387 → 0) — proving the writes are real, not a vacuous no-op match.
 *
 *   2. EQUAL (real captured backgrounds) — 0x1A15 is NEVER dispatched in attract (BONUS
 *      never reaches 0), but its dispatcher entry_1a07 (0x1A07) fires every gameplay frame.
 *      Hook 0x1A07, clone REAL fully-populated 25m states, seed the two output bytes to
 *      sentinels + a safe SP onto each (keeping the rest of the real RAM background), and
 *      confirm the candidate reproduces the oracle's RAM − the stack scratch below the entry SP. Because the
 *      routine reads nothing, any real background is a valid bed; this also proves it
 *      touches ONLY 0x6386/0x6387 and nothing else in a live memory image.
 *
 *   3. TEETH — two deliberately-broken twins, one per write, each of which the compare
 *      MUST catch:
 *        (a) broken-step  — writes 3 to BONUS_EXPIRED_STEP instead of 2; caught at 0x6386.
 *        (b) broken-delay — drops the BONUS_EXPIRED_DELAY clear; the 0x6387 sentinel
 *            survives and the diff catches it.
 *
 * Contract: RAM − the stack scratch below the entry SP (the memory-equivalence contract). LIVE-OUT is memory
 * only; the oracle's terminal `ret` pops the stack inside STACK_SCRATCH (SP seeded there)
 * and is excluded, and the dispatcher ignores the handler's residual registers/flags — so
 * neither SP/pc nor the register file is compared (never the full register file, never
 * cycles).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a15.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a15 as oracle } from "../../translated/loc_1a15.js";
import { loc_1a07 as oracleDispatcher } from "../../translated/loc_1a07.js";
import { startBonusExpiredDelay } from "../startBonusExpiredDelay.js";
import { BONUS_EXPIRED_STEP, BONUS_EXPIRED_DELAY, STACK_SCRATCH } from "../names.js";
import { Machine } from "../../machine.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const DISPATCHER = 0x1a07; // entry_1a07 — fires every gameplay frame; reaches loc_1a15 at state 1

// Sentinels seeded on the base entry so each write is observable: a dropped write leaves
// the sentinel behind and the RAM diff catches it.
const SENTINEL_STEP = 0x99;  // -> 0x6386 (routine writes 2)
const SENTINEL_DELAY = 0x77; // -> 0x6387 (routine writes 0)

// The oracle's terminal `ret` pops two bytes off the stack; point SP low in work RAM so
// the pop stays valid (never I/O) and lands wholly inside STACK_SCRATCH, which is excluded
// from the diff — so it never affects the compared state.
const SAFE_SP = 0x6bf8;

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

function firstRamDiffExStack(a, b, offToAddr, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] === b[i]) continue;
    const addr = offToAddr(i);
    if (dead(addr)) continue;
    return { addr, a: a[i], b: b[i] };
  }
  return null;
}

/** Oracle and candidate on FRESH clones of `entry` (a writer needs one per side); diff RAM − stack scratch. */
function runPair(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return firstRamDiffExStack(a.dumpState(), b.dumpState(), (off) => a.stateOffsetToAddr(off), entry.regs.sp);
}

/** `base` with the two output bytes seeded to sentinels and a safe stack. */
function makeEntry(base) {
  const e = base.clone();
  e.mem.write8(BONUS_EXPIRED_STEP, SENTINEL_STEP);
  e.mem.write8(BONUS_EXPIRED_DELAY, SENTINEL_DELAY);
  e.regs.sp = SAFE_SP;
  return e;
}

// -- 1. EQUAL (fresh sentinel entry) ------------------------------------------

test("EQUAL: startBonusExpiredDelay == oracle on a sentinel entry, and the writes are real", () => {
  const entry = makeEntry(new Machine(ROM).clone());

  const diff = runPair(entry, startBonusExpiredDelay);
  assert.equal(
    diff,
    null,
    diff && `diverged at 0x${(diff.addr ?? 0).toString(16)} (${diff.a}->${diff.b})`,
  );

  // Non-vacuous: the oracle actually performs both constant writes over the sentinels.
  const oc = entry.clone();
  oracle(oc);
  assert.equal(oc.mem.read8(BONUS_EXPIRED_STEP), 2, "oracle must advance BONUS_EXPIRED_STEP (0x6386) to 2");
  assert.equal(oc.mem.read8(BONUS_EXPIRED_DELAY), 0, "oracle must clear BONUS_EXPIRED_DELAY (0x6387) to 0");
  console.log("  EQUAL: sentinel entry — RAM − the stack scratch below the entry SP identical; oracle wrote 0x6386=2, 0x6387=0");
});

// -- 2. EQUAL (real captured backgrounds) -------------------------------------

/**
 * Clone the machine at up to K real 0x1A07 dispatches in attract — real, fully-populated 25m gameplay
 * states. The wrapper then runs the frozen dispatcher oracle so the host game proceeds undisturbed.
 */
function captureDispatchBackgrounds(K, maxFrames) {
  const caps = [];
  let capturing = true;
  const snap = new Map([[DISPATCHER, (mm) => {
    if (capturing && caps.length < K) caps.push(mm.clone());
    return oracleDispatcher(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  capturing = false;
  return caps;
}

test("EQUAL: startBonusExpiredDelay on real captured backgrounds — RAM − the stack scratch below the entry SP matches", () => {
  const caps = captureDispatchBackgrounds(64, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1A07 dispatch during attract");

  let compared = 0;
  for (const cap of caps) {
    const entry = cap.clone();
    entry.mem.write8(BONUS_EXPIRED_STEP, SENTINEL_STEP);
    entry.mem.write8(BONUS_EXPIRED_DELAY, SENTINEL_DELAY);
    entry.regs.sp = SAFE_SP;

    const diff = runPair(entry, startBonusExpiredDelay);
    assert.equal(
      diff,
      null,
      diff && `diverged on a real state at 0x${(diff.addr ?? 0).toString(16)} (${diff.a}->${diff.b})`,
    );
    compared++;
  }
  console.log(`  EQUAL/realism: ${compared} real captured backgrounds — RAM − the stack scratch below the entry SP == oracle`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** BUG: advances BONUS_EXPIRED_STEP to 3 instead of 2. Caught at 0x6386. */
function brokenStep(m) {
  const { mem } = m;
  mem.write8(BONUS_EXPIRED_DELAY, 0);
  mem.write8(BONUS_EXPIRED_STEP, 3); // BUG: should be 2
}

/** BUG: drops the delay-counter clear; the 0x6387 sentinel survives. Caught at 0x6387. */
function brokenDelay(m) {
  const { mem } = m;
  // BUG: missing `ld (0x6387),a` — BONUS_EXPIRED_DELAY never cleared
  mem.write8(BONUS_EXPIRED_STEP, 2);
}

test("TEETH: the broken-step twin is CAUGHT at BONUS_EXPIRED_STEP (0x6386)", () => {
  const entry = makeEntry(new Machine(ROM).clone());
  const diff = runPair(entry, brokenStep);
  assert.notEqual(diff, null, "the compare FAILED to catch a wrong BONUS_EXPIRED_STEP value — it is worthless");
  assert.equal(diff.addr, BONUS_EXPIRED_STEP, "must be caught at BONUS_EXPIRED_STEP (0x6386)");
  console.log(`  TEETH/step: caught at 0x6386 (oracle=${hx(diff.a)} broken=${hx(diff.b)})`);
});

test("TEETH: the broken-delay twin is CAUGHT at BONUS_EXPIRED_DELAY (0x6387)", () => {
  const entry = makeEntry(new Machine(ROM).clone());
  const diff = runPair(entry, brokenDelay);
  assert.notEqual(diff, null, "the compare FAILED to catch a dropped BONUS_EXPIRED_DELAY clear — it is worthless");
  assert.equal(diff.addr, BONUS_EXPIRED_DELAY, "must be caught at BONUS_EXPIRED_DELAY (0x6387)");
  console.log(`  TEETH/delay: caught at 0x6387 (oracle=${hx(diff.a)} broken=${hx(diff.b)})`);
});
