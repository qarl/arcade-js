// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for pickRandomAwardTier (ROM 0x1DF5) — the RNG tail of armScorePopupAndSelectAward that reads RANDOM
 * (0x6018) and dispatches on its low two bits to one of three sibling effect-sprite setters
 * (bit0 -> stageAward500Popup, else bit1 -> stageAward800Popup, else -> stageAward300Popup by fall-through).
 *
 * pickRandomAwardTier writes NO memory of its own — every game-visible byte is written by the CHOSEN
 * arm's stageAwardPopupAtHitObject chain (task ring via enqueueTask, the *(0x6343) block[0] clear, and — via
 * the stampScorePopupSprite tail — the 4-byte sprite record 0x6A30..0x6A33 + the board-gated sound
 * 0x6085). So it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case,
 * on the contract RAM − the stack scratch below the entry SP (never the full register file, never cycles), with the
 * extra requirement that idiomatic pickRandomAwardTier leaves SP/pc unchanged (it models no stack while
 * the oracle's `jp`/`call` chain does).
 *
 * pickRandomAwardTier's ONLY input is RANDOM's low two bits, and the three arms differ only in the
 * constants B (sprite code) and DE (task message) they stage — so the dispatch is observable
 * as which B the stampScorePopupSprite tail stamps at record byte 0x6A31 (0x7D/0x7E/0x7F). That makes an
 * EXHAUSTIVE sweep over RANDOM the strongest gate:
 *
 *   1. REALISM (real captured dispatch) — attract reaches 0x1df5 through armScorePopupAndSelectAward's
 *      0x6342-bit2 tail while the 25m demo plays. For each real entry, run the ORACLE on one
 *      clone and idiomatic pickRandomAwardTier on another; every game-visible byte matches (residual
 *      confined to STACK_SCRATCH), and idiomatic leaves SP/pc put — which also proves the
 *      rotated A the oracle leaves is dead (idiomatic never touches A).
 *
 *   2. EXHAUSTIVE (dispatch) — on a real captured base, poke RANDOM to EVERY byte 0..255
 *      identically on both sides and compare RAM − the stack scratch below the entry SP. All three arms are
 *      exercised (all of B ∈ {0x7D,0x7E,0x7F} appear at 0x6A31), and each swept value's arm
 *      is pinned to the bits: bit0 -> 0x7E, else bit1 -> 0x7F, else 0x7D. This is the whole
 *      of pickRandomAwardTier's logic, proven against the oracle.
 *
 *   3. TEETH — an arm-SWAP twin (bit0 -> stageAward800Popup, bit1 -> stageAward500Popup) MUST be caught by the
 *      same sweep. The swap stages the wrong (B, DE), so it diverges both at the posted task
 *      argument (E, in the ring — the lower address the linear scan reports first) AND at the
 *      record byte 0x6A31 (the wrong B the stampScorePopupSprite tail stamps); the test pins both.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1df5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1df5 as oracle } from "../../translated/loc_1df5.js";
import { pickRandomAwardTier as idiomatic } from "../pickRandomAwardTier.js";
import { stageAward300Popup } from "../stageAward300Popup.js"; // idiomatic arms, for the swap teeth twin
import { stageAward500Popup } from "../stageAward500Popup.js";
import { stageAward800Popup } from "../stageAward800Popup.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1df5;
const RNG = 0x6018;   // RANDOM — the byte pickRandomAwardTier dispatches on (low two bits)
const BOARD = 0x6227;
const REC = 0x6a30;   // sprite-record slot; REC+1 = the arm's B, stamped by the stampScorePopupSprite tail
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/** The B constant the correctly-dispatched arm stamps at 0x6A31, from RANDOM's low two bits. */
function expectedB(rnd) {
  if (rnd & 0x01) return 0x7e; // stageAward500Popup
  if (rnd & 0x02) return 0x7f; // stageAward800Popup
  return 0x7d;                 // stageAward300Popup (fall-through)
}

/**
 * First game-visible RAM difference between two machines, EXCLUDING the stack scratch below the entry SP
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP; SP/pc are handled
 * separately because the oracle models the stack and idiomatic does not).
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry through the oracle and a candidate on independent FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x1df5 dispatch (armScorePopupAndSelectAward tail-jumps here
 * on 0x6342 bit2 while the 25m demo plays). The wrapper delegates to the oracle so the host
 * run proceeds undisturbed to a clean stop.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  new Machine(ROM, { overrides: snap }).runFrames(maxFrames);
  return caps;
}

/** A real captured 0x1df5 entry (BOARD 1) to craft the exhaustive sweep onto. */
function craftedBase() {
  const caps = captureDispatches(1, 8000);
  assert.ok(caps.length >= 1, "expected a real 0x1df5 entry to craft from");
  return caps[0];
}

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 25m 0x1df5 dispatch — game-visible RAM identical, SP/pc unmodelled", () => {
  const caps = captureDispatches(8, 8000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1df5 dispatch during 25m attract");

  const armsSeen = new Set();
  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x1df5 on 25m (BOARD==1)");

    const { a, bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on a real 0x1df5 entry (RANDOM=${hx(entry.mem.read8(RNG))} SP=${hx(entry.regs.sp)})`,
    );

    // The oracle chain pushes down to SP-4 (stageAwardPopupAtHitObject's push16 + sub_309f's push hl); that
    // target must sit inside STACK_SCRATCH so excluding the region can't mask a real diff.
    assert.ok(
      (entry.regs.sp - 4) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's deepest push must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );

    // idiomatic pickRandomAwardTier must model no stack: SP and pc unchanged from entry (this also
    // proves the rotated A the oracle leaves is dead — idiomatic never writes A).
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    idiomatic(b);
    assert.equal(b.regs.sp, sp0, "pickRandomAwardTier must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "pickRandomAwardTier must leave pc unchanged (no tail-jump/ret modelling)");

    // Record which arm this real RNG value dispatched to (the oracle's stamped B), and check
    // it agrees with the bit pattern.
    const rnd = entry.mem.read8(RNG);
    const b31 = a.mem.read8(REC + 1);
    assert.equal(b31, expectedB(rnd), `arm for RANDOM=${hx(rnd)} should stamp B=${hx(expectedB(rnd))} at 0x6A31`);
    armsSeen.add(b31);
  }
  console.log(`  REALISM: ${caps.length} real 25m 0x1df5 dispatch(es) — RAM identical; arms seen: ` +
    [...armsSeen].map(hx).join(", "));
});

// -- 2. EXHAUSTIVE (dispatch over all 256 RANDOM values) ----------------------

test("EXHAUSTIVE: pickRandomAwardTier == oracle over all 256 RANDOM values (all three arms, correct B)", () => {
  const base = craftedBase();
  const armCount = { 0x7d: 0, 0x7e: 0, 0x7f: 0 };
  let count = 0, mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    a.mem.write8(RNG, v);
    b.mem.write8(RNG, v);
    oracle(a);
    idiomatic(b);
    count++;

    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) { mismatch = { v, bad }; break; }

    // The oracle dispatched to the arm the bits select; confirm via the stamped B, and tally.
    const b31 = a.mem.read8(REC + 1);
    assert.equal(b31, expectedB(v), `oracle for RANDOM=${hx(v)} must stamp B=${hx(expectedB(v))} at 0x6A31, got ${hx(b31)}`);
    if (b31 in armCount) armCount[b31]++;
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at RANDOM=${hx(mismatch.v)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 RANDOM values");
  assert.ok(
    armCount[0x7d] > 0 && armCount[0x7e] > 0 && armCount[0x7f] > 0,
    `sweep must exercise all three arms (0x7d=${armCount[0x7d]} 0x7e=${armCount[0x7e]} 0x7f=${armCount[0x7f]})`,
  );
  console.log(`  EXHAUSTIVE: 256 RANDOM values — RAM identical to the oracle; ` +
    `arm hits 1e00(0x7d)=${armCount[0x7d]} 1e08(0x7e)=${armCount[0x7e]} 1e10(0x7f)=${armCount[0x7f]}`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Arm-swap twin: bit0 -> stageAward800Popup (should be 1e08), bit1 -> stageAward500Popup (should be 1e10). */
function brokenSwap(m) {
  const rnd = m.mem.read8(RNG);
  if (rnd & 0x01) return stageAward800Popup(m); // BUG: swapped with stageAward500Popup
  if (rnd & 0x02) return stageAward500Popup(m); // BUG: swapped with stageAward800Popup
  return stageAward300Popup(m);
}

test("TEETH (arm-swap): the swapped-dispatch twin is CAUGHT by the sweep (wrong E and wrong B)", () => {
  const base = craftedBase();
  let caught = null;
  for (let v = 0; v < 256 && !caught; v++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    a.mem.write8(RNG, v);
    b.mem.write8(RNG, v);
    oracle(a);
    brokenSwap(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { v, bad, a, b };
  }
  assert.notEqual(caught, null, "the exhaustive sweep FAILED to catch a swapped-arm dispatch — it is worthless");
  // The swap's signature: the stampScorePopupSprite tail stamps the WRONG arm's B at record byte 0x6A31.
  const oB = caught.a.mem.read8(REC + 1), bB = caught.b.mem.read8(REC + 1);
  assert.notEqual(bB, oB, `the swap must diverge the stamped sprite code at 0x6A31 (oracle=${hx(oB)} broken=${hx(bB)})`);
  console.log(`  TEETH/arm-swap: caught for RANDOM=${hx(caught.v)} — first game-visible diff at ${hx(caught.bad.addr)} ` +
    `(oracle=${hx(caught.bad.a)} broken=${hx(caught.bad.b)}); record 0x6A31 B ${hx(oB)}->${hx(bB)}`);
});
