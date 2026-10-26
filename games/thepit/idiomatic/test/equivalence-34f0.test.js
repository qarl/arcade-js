// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for reseedMoverCadenceAndRearmState (ROM 0x34f0, The Pit) — the periodic
 * refresh that takes a fresh pseudo-random draw, forces its high bit set, stores
 * it into the random/animation byte (0x808b), and re-arms the actor state/timer
 * byte (0x8084) to 9.
 *
 * WHY THIS ISN'T unitEquivalence. Two facts shape the gate:
 *   1. UNREACHED IN ATTRACT. The chain that reaches reseedMoverCadenceAndRearmState (the mover
 *      housekeeping's once-per-256-tick wrap) is a gameplay-only path — hooking
 *      0x34f0 over 3000+ attract frames yields zero dispatches. So there is no
 *      natural entry for the shared unitEquivalence harness to snapshot, and
 *      force-injecting one would corrupt the host stack (the oracle ends with an
 *      unbalanced return).
 *   2. NEAR-LEAF WITH DEAD WORKING REGISTERS. reseedMoverCadenceAndRearmState reads no caller input; its
 *      only input is the generator state in memory. The oracle leaves working
 *      registers behind (the generator step's residue) and pops the stack on
 *      return; every one of those is dead ABI. unitEquivalence diffs the FULL
 *      register file, so it would false-fail a correct idiomatic rewrite on those
 *      dead registers — exactly the case the pipeline warns about.
 * So, like its sibling near-leaf advanceRandom (0x4b1a), this gate compares the
 * DECLARED live-out — work RAM + the accumulator — via firstStateDiff, and it uses
 * the machine-factory overrides hook to CAPTURE real attract states (clone, run
 * both) rather than to dispatch the target.
 *
 * The one wrinkle: the oracle models the Z80 stack (it pushes a return address for
 * its generator call), so it writes two bytes just below SP that the cycle-free
 * idiomatic routine does not. That dead stack-push window is excluded from the RAM
 * diff — it is the dropped stack ABI, read by nothing.
 *
 * FOUR checks:
 *   1. EQUAL (real captured attract states) — clone the running attract machine at
 *      a spread of frames, run the oracle and reseedMoverCadenceAndRearmState on independent clones of
 *      each, and diff work RAM (minus the stack push) + the accumulator.
 *   2. SCOPE — the oracle changes ONLY {0x800d,0x800e,0x8084,0x808b} plus the
 *      stack-push window; nothing else. This licenses the memory-only contract.
 *   3. EXHAUSTIVE — over all 65,536 generator states, seed both bytes identically
 *      on both sides and confirm the two written bytes (0x808b,0x8084) and the two
 *      advanced generator bytes (0x800d,0x800e) match the oracle, and 0x808b's high
 *      bit is always set. Covers the all-zero reseed branch too.
 *   4. TEETH — a twin that drops the high-bit force (stores the raw draw) and a
 *      twin that arms the state byte to the wrong value MUST both be caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-34f0.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_34f0 as oracle } from "../../translated/loc_34f0.js";
import { reseedMoverCadenceAndRearmState } from "../reseedMoverCadenceAndRearmState.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const RNG_LOW = 0x800d;
const RNG_HIGH = 0x800e;
const ENEMY_ACTION_TIMER = 0x808b; // the random/animation byte reseedMoverCadenceAndRearmState seeds
const ENEMY_WORK_SPRITE = 0x8084; // the actor state/timer byte reseedMoverCadenceAndRearmState re-arms
const EXPECTED_WRITES = new Set([RNG_LOW, RNG_HIGH, ENEMY_ACTION_TIMER, ENEMY_WORK_SPRITE]);
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The Pit's routine registry is async, so build the factory once and reuse it.
const makeMachine = ROM_PRESENT ? await makeMachineFactory(ROM) : null;

/**
 * Real attract machine states: run the game and clone it at a spread of frames.
 * Each clone is a genuine in-play machine with its frame machinery neutralised
 * (safe to run the oracle, which steps cycles, on).
 */
function captureStates(count, stride, startFrame) {
  const m = makeMachine();
  m.runFrames(startFrame);
  const caps = [];
  for (let i = 0; i < count; i++) {
    m.runFrames(stride);
    caps.push(m.clone());
  }
  return caps;
}

/**
 * The declared contract: work RAM (minus the oracle's dead stack-push window) plus
 * the accumulator. Returns a description of the first difference, or null.
 */
function contractDiff(oracleM, otherM, stackSkip) {
  const da = oracleM.dumpState();
  const db = otherM.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = oracleM.stateOffsetToAddr(i);
    if (stackSkip(addr)) continue; // dropped stack ABI, read by nothing
    return `RAM@${hx(addr ?? 0)} oracle=${da[i]} other=${db[i]}`;
  }
  if (oracleM.regs.a !== otherM.regs.a) {
    return `A oracle=${oracleM.regs.a} other=${otherM.regs.a}`;
  }
  return null;
}

/** The two bytes the oracle's stack push touches, given the SP it ran with. */
function stackWindow(sp) {
  return deadStackBelow({ lo: sp - 2, hi: sp }, sp);
}

// -- 1. EQUAL + 2. SCOPE (real captured attract states) -----------------------

test("EQUAL + SCOPE: reseedMoverCadenceAndRearmState == oracle on real attract states (RAM+A), oracle writes only its four bytes", () => {
  const caps = captureStates(8, 120, 90);
  assert.ok(caps.length >= 1, "expected at least one captured attract state");

  for (const cap of caps) {
    const sp = cap.regs.sp;
    const skip = stackWindow(sp);

    // SCOPE: the oracle changes only its four work-RAM bytes plus the stack push.
    const oracleClone = cap.clone();
    const before = oracleClone.dumpState();
    oracle(oracleClone);
    const after = oracleClone.dumpState();
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      const addr = oracleClone.stateOffsetToAddr(i);
      if (skip(addr)) continue;
      assert.ok(
        EXPECTED_WRITES.has(addr),
        `oracle wrote an unexpected address ${hx(addr ?? 0)} (${before[i]}->${after[i]})`,
      );
    }

    // EQUAL: idiomatic reproduces the oracle on the declared contract.
    const idioClone = cap.clone();
    reseedMoverCadenceAndRearmState(idioClone);
    const diff = contractDiff(oracleClone, idioClone, skip);
    assert.equal(diff, null, diff && `contract mismatch on a real attract state: ${diff}`);

    // The attract PRNG sits at 0 here, so this is the all-zero reseed path: the
    // draw is 1, forced to 0x81, and the state byte is armed to 9.
    assert.equal(idioClone.mem.read8(ENEMY_WORK_SPRITE), 9, "state byte must be armed to 9");
    assert.equal(idioClone.regs.a, 9, "accumulator must be left at 9");
  }
  console.log(`  EQUAL/scope: ${caps.length} real attract states — RAM+A identical, oracle wrote only its four bytes`);
});

// -- 3. EXHAUSTIVE over the whole 16-bit generator state ----------------------

test("EXHAUSTIVE: over all 65,536 generator states the written + advanced bytes match the oracle", () => {
  const [entry] = captureStates(1, 1, 200);
  assert.ok(entry, "need a base attract state to sweep from");
  const oracleM = entry.clone();
  const idioM = entry.clone();
  // A fixed harmless stack anchor so the oracle's push/pop only ever touch a known
  // scratch cell as it is re-run in place (its net return moves SP otherwise).
  const SP_ANCHOR = 0x8780;

  let checked = 0;
  let sawReseed = false;
  let sawHighBitCleared = false; // a raw draw < 128, proving the high-bit force bites

  for (let high = 0; high < 256; high++) {
    for (let low = 0; low < 256; low++) {
      for (const mm of [oracleM, idioM]) {
        mm.mem.write8(RNG_LOW, low);
        mm.mem.write8(RNG_HIGH, high);
        mm.regs.sp = SP_ANCHOR;
      }
      oracle(oracleM);
      reseedMoverCadenceAndRearmState(idioM);

      for (const addr of [RNG_LOW, RNG_HIGH, ENEMY_ACTION_TIMER, ENEMY_WORK_SPRITE]) {
        const o = oracleM.mem.read8(addr);
        const b = idioM.mem.read8(addr);
        if (o !== b) {
          assert.fail(
            `state ${hx((high << 8) | low)}: ${hx(addr)} differs — oracle=${o} idiomatic=${b}`,
          );
        }
      }
      // The stored seed always has its high bit set, whatever the draw was.
      assert.ok(
        (idioM.mem.read8(ENEMY_ACTION_TIMER) & 0x80) !== 0,
        `state ${hx((high << 8) | low)}: stored seed ${hx(idioM.mem.read8(ENEMY_ACTION_TIMER))} lost its high bit`,
      );
      // The raw draw's high bit is the old high byte's low bit; an even high byte
      // clears it, so the high-bit force actually changed the stored value here.
      if ((high & 1) === 0 && (low | high) !== 0) sawHighBitCleared = true;
      if (low === 0 && high === 0) sawReseed = true;
      checked++;
    }
  }

  assert.equal(checked, 65536, "must have swept the full 16-bit generator state domain");
  assert.ok(sawReseed, "the all-zero reseed branch must have been exercised");
  assert.ok(sawHighBitCleared, "must have hit a raw draw below 128 so the high-bit force actually bites");
  console.log(`  EXHAUSTIVE: all ${checked} generator states agree (written + advanced bytes; high bit always set)`);
});

// -- 4. TEETH: broken twins the gate MUST catch -------------------------------

/** Broken twin A: stores the RAW draw, dropping the high-bit force. */
function brokenNoHighBit(m) {
  const draw = advanceRandomLike(m); // same generator step, no `| 0x80`
  m.mem.write8(ENEMY_ACTION_TIMER, draw);
  m.mem.write8(ENEMY_WORK_SPRITE, 9);
  m.regs.a = 9;
}

/** Broken twin B: arms the state byte to the wrong value. */
function brokenWrongState(m) {
  const draw = advanceRandomLike(m) | 0x80;
  m.mem.write8(ENEMY_ACTION_TIMER, draw);
  m.mem.write8(ENEMY_WORK_SPRITE, 8); // BUG: should be 9
  m.regs.a = 8;
}

/** The generator step the twins share, so only the injected bug differs. */
function advanceRandomLike(m) {
  const high = m.mem.read8(RNG_HIGH);
  let low = m.mem.read8(RNG_LOW);
  if ((high | low) === 0) low = 2;
  const feedback = ((low >> 1) & 1) ^ ((low >> 2) & 1);
  const newHigh = (feedback << 7) | (high >> 1);
  const newLow = ((high & 1) << 7) | (low >> 1);
  m.mem.write8(RNG_HIGH, newHigh);
  m.mem.write8(RNG_LOW, newLow);
  m.regs.a = newLow;
  return newLow;
}

test("TEETH: dropping the high-bit force is CAUGHT at the seed byte", () => {
  // An even high byte makes the raw draw's bit 7 clear, so the force changes the value.
  const [entry] = captureStates(1, 1, 200);
  const cap = entry.clone();
  cap.mem.write8(RNG_LOW, 0x6b);
  cap.mem.write8(RNG_HIGH, 0x00);
  const sp = cap.regs.sp;
  const skip = stackWindow(sp);

  const a = cap.clone();
  const b = cap.clone();
  oracle(a);
  brokenNoHighBit(b);
  const diff = contractDiff(a, b, skip);
  assert.notEqual(diff, null, "the gate FAILED to catch the dropped high-bit force — it is worthless");
  assert.ok(diff.startsWith(`RAM@${hx(ENEMY_ACTION_TIMER)}`), `teeth caught the wrong thing: ${diff} (expected ${hx(ENEMY_ACTION_TIMER)})`);
  console.log(`  TEETH: dropped high-bit force caught (${diff})`);
});

test("TEETH: arming the state byte to the wrong value is CAUGHT at 0x8084", () => {
  const [entry] = captureStates(1, 1, 200);
  const cap = entry.clone();
  const sp = cap.regs.sp;
  const skip = stackWindow(sp);

  const a = cap.clone();
  const b = cap.clone();
  oracle(a);
  brokenWrongState(b);
  const diff = contractDiff(a, b, skip);
  assert.notEqual(diff, null, "the gate FAILED to catch a wrong state-byte arm — it is worthless");
  assert.ok(diff.startsWith(`RAM@${hx(ENEMY_WORK_SPRITE)}`), `teeth caught the wrong thing: ${diff} (expected ${hx(ENEMY_WORK_SPRITE)})`);
  console.log(`  TEETH: wrong state-byte arm caught (${diff})`);
});
