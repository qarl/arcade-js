// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for advanceDormantMover (ROM 0x34da, The Pit) — the mover
 * housekeeping that bumps a free-running tick counter (0x8090) each call, on the
 * once-every-256 wrap hands off to the periodic refresh (reseedMoverCadenceAndRearmState), and otherwise
 * advances a slower second counter (0x8085) on every 4th tick while holding that
 * counter's bit 3 clear.
 *
 * WHY THIS ISN'T unitEquivalence (same two reasons as its sibling reseedMoverCadenceAndRearmState):
 *   1. UNREACHED IN ATTRACT. advanceDormantMover's caller (stepEnemyMover's tick housekeeping) is a
 *      gameplay path — hooking 0x34da over 3000+ attract frames yields zero
 *      dispatches. There is no natural entry for the shared unitEquivalence harness
 *      to snapshot, and force-injecting one would corrupt the host stack.
 *   2. DEAD, PATH-DEPENDENT WORKING REGISTERS. The accumulator the oracle leaves is
 *      the refresh's value on a wrap, the low tick bits on a skipped tick, or the
 *      new second-counter value on the 4th tick — all dead ABI (the caller reaches
 *      here only by tail-jump). unitEquivalence diffs the FULL register file, so it
 *      would false-fail a correct rewrite on those dead registers.
 * So, like reseedMoverCadenceAndRearmState and advanceRandom, this gate compares the DECLARED live-out —
 * work RAM only — via a memory diff, and uses the machine-factory overrides hook to
 * CAPTURE real attract states (clone, run both) rather than to dispatch the target.
 *
 * The one wrinkle: on the WRAP path the oracle vectors into the still-oracle refresh
 * (reseedMoverCadenceAndRearmState), which models the Z80 stack — it pushes a two-byte return address for
 * its generator call just below SP. The cycle-free idiomatic routine calls the
 * idiomatic refresh directly and never touches the stack, so those two dead stack
 * bytes are excluded from the RAM diff (the dropped stack ABI, read by nothing).
 *
 * FIVE checks:
 *   1. EXHAUSTIVE — over all 65,536 (tick, second-counter) pairs, seed both bytes
 *      identically on both sides and confirm work RAM matches the oracle. This
 *      sweeps all three paths (the do-nothing tick, the 4th-tick advance, and the
 *      wrap→refresh) and every bit-3 boundary of the second counter.
 *   2. SCOPE — on one state of each path type the oracle changes ONLY its expected
 *      addresses (plus the wrap's dead stack push); nothing else. Licenses the
 *      memory-only contract.
 *   3. EQUAL (real captured attract states) — clone the running attract machine at a
 *      spread of frames and confirm idiomatic == oracle on each real state.
 *   4. WRAP GENERATOR SWEEP — on the wrap beat, over a spread of generator states,
 *      the refresh's reseed matches the oracle (the wrap path delegates correctly).
 *   5. TEETH — three broken twins (drop the bit-3 hold, skip the refresh on a wrap,
 *      never advance the second counter) MUST all be caught.
 *
 * Run: node --test games/thepit/idiomatic/test/equivalence-34da.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_34da as oracle } from "../../translated/loc_34da.js";
import { advanceDormantMover } from "../advanceDormantMover.js";
import { reseedMoverCadenceAndRearmState as idioRefresh } from "../reseedMoverCadenceAndRearmState.js";
import { makeMachineFactory } from "../../machine.js";
import { firstStateDiff, deadStackBelow } from "../../../../core/equivalence.js";

const ROM_PATH = new URL("../../rom/maincpu.bin", import.meta.url);
const ROM_PRESENT = existsSync(ROM_PATH);
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(ROM_PATH)) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not present at games/thepit/rom/maincpu.bin" }, fn);

const TICK = 0x8090; // the free-running tick counter, bumped every call
const SECOND = 0x8085; // the slower second counter, advanced on every 4th tick
const RNG_LOW = 0x800d;
const RNG_HIGH = 0x800e;
const ENEMY_ACTION_TIMER = 0x808b; // reseeded by the refresh on a wrap
const ENEMY_WORK_SPRITE = 0x8084; // re-armed to 9 by the refresh on a wrap
// A fixed SP high in scratch so the oracle's refresh push lands at a known cell.
const SP_ANCHOR = 0x8780;
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

/** The two bytes below the entry SP the oracle's wrap-path refresh push touches. */
function stackWindow(sp) {
  return deadStackBelow({ lo: sp - 2, hi: sp }, sp);
}

/**
 * The declared contract: work RAM only (minus the oracle's dead stack-push window).
 * Returns a description of the first difference, or null. The accumulator is NOT
 * compared — it is dead, path-dependent ABI (see the header).
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
  return null;
}

/** Prime a machine for one deterministic run of a given tick/second/generator input. */
function prime(m, tickByte, secondByte) {
  m.mem.write8(TICK, tickByte);
  m.mem.write8(SECOND, secondByte);
  m.mem.write8(RNG_LOW, 0x37); // fixed nonzero generator seed for the wrap beat
  m.mem.write8(RNG_HIGH, 0x9a);
  m.regs.sp = SP_ANCHOR;
}

// -- 1. EXHAUSTIVE over the whole (tick, second-counter) input domain ----------

test("EXHAUSTIVE: over all 65,536 (tick, second) pairs the touched work RAM matches the oracle", () => {
  const [entry] = captureStates(1, 1, 200);
  assert.ok(entry, "need a base attract state to sweep from");
  const oracleM = entry.clone();
  const idioM = entry.clone();
  const skip = stackWindow(SP_ANCHOR);

  let checked = 0;
  let sawSkip = false; // the do-nothing tick
  let sawFourth = false; // the every-4th advance
  let sawWrap = false; // the wrap → refresh
  let sawBit3Held = false; // a second-counter advance whose bit 3 was actually cleared

  for (let tickByte = 0; tickByte < 256; tickByte++) {
    for (let secondByte = 0; secondByte < 256; secondByte++) {
      prime(oracleM, tickByte, secondByte);
      prime(idioM, tickByte, secondByte);
      oracle(oracleM);
      advanceDormantMover(idioM);

      const diff = contractDiff(oracleM, idioM, skip);
      if (diff) {
        assert.fail(`(tick=${hx(tickByte)}, second=${hx(secondByte)}): ${diff}`);
      }

      const nextTick = (tickByte + 1) % 256;
      if (nextTick === 0) sawWrap = true;
      else if (nextTick % 4 !== 0) sawSkip = true;
      else {
        sawFourth = true;
        // Bit 3 set going in and cleared coming out proves the hold actually bit.
        if ((idioM.mem.read8(SECOND) & 0x08) === 0 && (((secondByte + 1) & 0x08) !== 0)) {
          sawBit3Held = true;
        }
      }
      checked++;
    }
  }

  assert.equal(checked, 65536, "must have swept the full (tick, second) domain");
  assert.ok(sawSkip, "the do-nothing tick path must have been exercised");
  assert.ok(sawFourth, "the every-4th-tick advance must have been exercised");
  assert.ok(sawWrap, "the wrap → refresh path must have been exercised");
  assert.ok(sawBit3Held, "a second-counter advance that actually needed bit 3 cleared must have occurred");
  console.log(`  EXHAUSTIVE: all ${checked} (tick, second) pairs agree across all three paths`);
});

// -- 2. SCOPE: the oracle touches only its expected addresses per path ----------

test("SCOPE: the oracle changes only its path's expected addresses (plus the wrap's dead stack push)", () => {
  const [entry] = captureStates(1, 1, 220);
  assert.ok(entry, "need a base attract state");
  const skip = stackWindow(SP_ANCHOR);

  // tickByte -> the set the oracle is allowed to write on that path.
  const cases = [
    { tickByte: 0x00, secondByte: 0x10, expect: new Set([TICK]), label: "do-nothing tick" },
    { tickByte: 0x03, secondByte: 0x10, expect: new Set([TICK, SECOND]), label: "every-4th advance" },
    {
      tickByte: 0xff,
      secondByte: 0x10,
      expect: new Set([TICK, ENEMY_ACTION_TIMER, ENEMY_WORK_SPRITE, RNG_LOW, RNG_HIGH]),
      label: "wrap → refresh",
    },
  ];

  for (const { tickByte, secondByte, expect, label } of cases) {
    const m = entry.clone();
    prime(m, tickByte, secondByte);
    const before = m.dumpState();
    oracle(m);
    const after = m.dumpState();
    for (let i = 0; i < before.length; i++) {
      if (before[i] === after[i]) continue;
      const addr = m.stateOffsetToAddr(i);
      if (skip(addr)) continue;
      assert.ok(
        expect.has(addr),
        `${label}: oracle wrote an unexpected address ${hx(addr ?? 0)} (${before[i]}->${after[i]})`,
      );
    }
  }
  console.log("  SCOPE: each path writes only its expected work-RAM bytes (wrap's stack push aside)");
});

// -- 3. EQUAL on real captured attract states ----------------------------------

test("EQUAL: advanceDormantMover == oracle on real captured attract states (work RAM)", () => {
  const caps = captureStates(8, 120, 90);
  assert.ok(caps.length >= 1, "expected at least one captured attract state");

  for (const cap of caps) {
    const sp = cap.regs.sp;
    const skip = stackWindow(sp);
    const a = cap.clone();
    const b = cap.clone();
    oracle(a);
    advanceDormantMover(b);
    const diff = contractDiff(a, b, skip);
    assert.equal(diff, null, diff && `contract mismatch on a real attract state: ${diff}`);
  }
  console.log(`  EQUAL: ${caps.length} real attract states — work RAM identical to the oracle`);
});

// -- 4. WRAP GENERATOR SWEEP: the wrap path delegates to the refresh correctly --

test("WRAP: on the wrap beat the refresh reseed matches the oracle over a spread of generator states", () => {
  const [entry] = captureStates(1, 1, 240);
  assert.ok(entry, "need a base attract state");
  const oracleM = entry.clone();
  const idioM = entry.clone();
  const skip = stackWindow(SP_ANCHOR);

  let checked = 0;
  let sawHighBitForced = false;
  for (let high = 0; high < 256; high += 7) {
    for (let low = 0; low < 256; low += 5) {
      for (const mm of [oracleM, idioM]) {
        mm.mem.write8(TICK, 0xff); // force the wrap
        mm.mem.write8(SECOND, 0x22);
        mm.mem.write8(RNG_LOW, low);
        mm.mem.write8(RNG_HIGH, high);
        mm.regs.sp = SP_ANCHOR;
      }
      oracle(oracleM);
      advanceDormantMover(idioM);
      const diff = contractDiff(oracleM, idioM, skip);
      assert.equal(diff, null, diff && `wrap mismatch at generator ${hx((high << 8) | low)}: ${diff}`);
      // The refresh forces the stored seed's high bit set.
      assert.ok(
        (idioM.mem.read8(ENEMY_ACTION_TIMER) & 0x80) !== 0,
        `wrap: stored seed ${hx(idioM.mem.read8(ENEMY_ACTION_TIMER))} lost its high bit`,
      );
      if ((high & 1) === 0) sawHighBitForced = true;
      checked++;
    }
  }
  assert.ok(checked > 0 && sawHighBitForced, "must have swept generator states including a forced high bit");
  console.log(`  WRAP: ${checked} generator states on the wrap beat agree with the oracle`);
});

// -- 5. TEETH: broken twins the gate MUST catch --------------------------------

/** Twin A: drops the bit-3 hold on the second counter (stores the raw +1). */
function brokenNoBit3Hold(m) {
  const { mem } = m;
  const tick = (mem.read8(TICK) + 1) % 256;
  mem.write8(TICK, tick);
  if (tick === 0) { idioRefresh(m); return; }
  if (tick % 4 !== 0) return;
  mem.write8(SECOND, (mem.read8(SECOND) + 1) % 256); // BUG: no bit-3 clear
}

/** Twin B: skips the periodic refresh on a wrap. */
function brokenSkipRefresh(m) {
  const { mem } = m;
  const tick = (mem.read8(TICK) + 1) % 256;
  mem.write8(TICK, tick);
  if (tick === 0) return; // BUG: should run the refresh
  if (tick % 4 !== 0) return;
  mem.write8(SECOND, (mem.read8(SECOND) + 1) & 0xf7);
}

/** Twin C: never advances the second counter on the 4th tick. */
function brokenNoSecond(m) {
  const { mem } = m;
  const tick = (mem.read8(TICK) + 1) % 256;
  mem.write8(TICK, tick);
  if (tick === 0) { idioRefresh(m); return; }
  // BUG: 4th-tick advance of the second counter is missing entirely
}

test("TEETH: dropping the bit-3 hold is CAUGHT at the second counter", () => {
  const [entry] = captureStates(1, 1, 200);
  const cap = entry.clone();
  prime(cap, 0x03, 0x07); // 4th tick; second counter 7 -> +1 crosses into bit 3
  const skip = stackWindow(cap.regs.sp);
  const a = cap.clone();
  const b = cap.clone();
  oracle(a);
  brokenNoBit3Hold(b);
  const diff = contractDiff(a, b, skip);
  assert.notEqual(diff, null, "the gate FAILED to catch the dropped bit-3 hold — it is worthless");
  assert.ok(diff.startsWith(`RAM@${hx(SECOND)}`), `teeth caught the wrong thing: ${diff} (expected ${hx(SECOND)})`);
  console.log(`  TEETH: dropped bit-3 hold caught (${diff})`);
});

test("TEETH: skipping the refresh on a wrap is CAUGHT", () => {
  const [entry] = captureStates(1, 1, 200);
  const cap = entry.clone();
  prime(cap, 0xff, 0x22); // wrap beat
  cap.mem.write8(ENEMY_WORK_SPRITE, 0); // ensure the refresh's re-arm to 9 is observable
  const skip = stackWindow(cap.regs.sp);
  const a = cap.clone();
  const b = cap.clone();
  oracle(a);
  brokenSkipRefresh(b);
  const diff = contractDiff(a, b, skip);
  assert.notEqual(diff, null, "the gate FAILED to catch a skipped refresh — it is worthless");
  const refreshAddrs = new Set([`RAM@${hx(RNG_LOW)}`, `RAM@${hx(RNG_HIGH)}`, `RAM@${hx(ENEMY_WORK_SPRITE)}`, `RAM@${hx(ENEMY_ACTION_TIMER)}`]);
  assert.ok(
    [...refreshAddrs].some((p) => diff.startsWith(p)),
    `teeth caught the wrong thing: ${diff} (expected one of the refresh's bytes)`,
  );
  console.log(`  TEETH: skipped refresh caught (${diff})`);
});

test("TEETH: never advancing the second counter is CAUGHT", () => {
  const [entry] = captureStates(1, 1, 200);
  const cap = entry.clone();
  prime(cap, 0x03, 0x05); // 4th tick; second counter must advance 5 -> 6
  const skip = stackWindow(cap.regs.sp);
  const a = cap.clone();
  const b = cap.clone();
  oracle(a);
  brokenNoSecond(b);
  const diff = contractDiff(a, b, skip);
  assert.notEqual(diff, null, "the gate FAILED to catch a missing second-counter advance — it is worthless");
  assert.ok(diff.startsWith(`RAM@${hx(SECOND)}`), `teeth caught the wrong thing: ${diff} (expected ${hx(SECOND)})`);
  console.log(`  TEETH: missing second-counter advance caught (${diff})`);
});
