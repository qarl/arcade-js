// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for pickAwardTierByObjectCount (ROM 0x3E70) — the sub_1dbd effect-sprite setter that
 * picks one of three (DE, B) parameter pairs from A's two low bits and tail-calls the
 * record-stamp routine.
 *
 * pickAwardTierByObjectCount WRITES memory (through its tail: the task ring via enqueueTask, the
 * sprite record 0x6A30..0x6A33, the gated sound 0x6085) and is NOT a leaf, so it is gated
 * by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case. Its own body is a
 * pure priority encoder on A; every downstream branch lives in the tail and is IDENTICAL
 * on both sides. DISSOLVED FORM (sp-trampoline): the tail is now the idiomatic awardScorePopup
 * (memory-eq to the frozen loc_1e28 oracle) — a plain JS call that models NEITHER the guest
 * stack nor the guest `ret`. So the contract is game-visible RAM − the stack scratch below the entry SP, NOT the old
 * RAM+SP+pc: the oracle's tail-`ret` moves SP/pc by the dead return-word, the idiomatic tail
 * does not, and that divergence is confined to the dead STACK_SCRATCH region (see the
 * loc_1e28 ret dissolution). Attract only ever reaches arm 1 (A=0x00), so arms 2/3 are
 * covered with crafted A values:
 *
 *   1. REALISM (real captured dispatch) — attract dispatches 0x3e70 on 25m (BOARD 1) with
 *      A=0x00 (arm 1). Run the ORACLE on one clone and idiomatic pickAwardTierByObjectCount on another and
 *      confirm every game-visible byte matches (residual confined to the dead STACK_SCRATCH,
 *      where the oracle's tail push/ret leaves a word the dissolved idiomatic tail does not).
 *
 *   2. ARM SELECTION (exhaustive crafted) — on a real 0x3e70 entry, poke A to EVERY byte
 *      0..255 identically on both sides (freeing the ring slot so the enqueue is observable)
 *      and compare RAM − the stack scratch below the entry SP. This is the whole input domain of the
 *      encoder: A is the only input that changes its behaviour. It pins all three arms
 *      (0x6A31 = B ∈ {0x7B,0x7D,0x7F}; the enqueued E ∈ {1,3,5}) and crafts arms 2 and 3
 *      attract never reaches. Both arm-distinguishing channels (the record byte and the
 *      task ring) are checked.
 *
 *   3. TEETH — two twins the A-sweep MUST catch: (a) a bit-ORDER swap (tests A bit 1 before
 *      A bit 0) — a wrong priority encoder; (b) a wrong PARAM byte (arm 2 emits B=0x7C, not
 *      0x7D) — caught at the record byte 0x6A31.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-3e70.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3e70 as oracle } from "../../translated/loc_3e70.js";
import { pickAwardTierByObjectCount as idiomatic } from "../pickAwardTierByObjectCount.js";
import { loc_1e28 } from "../../translated/loc_1e28.js"; // the frozen oracle tail, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x3e70;
const BOARD = 0x6227;
const REC = 0x6a30;       // sprite-record slot; REC+1 = B, the arm-distinguishing byte
const SND = 0x6085;       // gated sound latch (written by the loc_1e28 tail)
const TASK_TAIL = 0x60b0; // low byte of the task ring's next write slot (page 0x60 fixed)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible discrepancy between two machines: RAM minus the stack scratch below the entry SP
 * region. Returns { addr, a, b } of the first difference or null, plus the count of tolerated
 * stack-scratch byte diffs. SP/pc are NOT compared — they are the dropped guest-stack model:
 * the oracle's tail-`ret` moves them, the dissolved idiomatic tail does not, and neither is
 * consumed by the caller (the rst-0x28 return is the JS call stack now).
 */
function contractDiff(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr: hx(addr), a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry through the oracle and a candidate on independent FRESH clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...contractDiff(a, b, entry.regs.sp) };
}

/**
 * Run attract and clone the machine at each real 0x3e70 dispatch (reached via armScorePopupAndSelectAward's
 * `jp c,0x3e70` while the 25m demo plays). The wrapper delegates to the oracle so the host
 * run proceeds to a clean stop.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

/** A real captured 0x3e70 entry (BOARD 1) to craft the A-sweep onto. */
function craftedBase() {
  const caps = captureDispatches(1, 6000);
  assert.ok(caps.length >= 1, "expected a real 0x3e70 entry to craft from");
  return caps[0];
}

/**
 * Sweep A over 0..255 on `base`, freeing the ring slot so the enqueue is observable, and
 * compare `candidate` against the oracle on the contract for each. Returns the first
 * mismatch (or null), the per-arm counts (by the oracle's written 0x6A31), and the count.
 */
function sweepA(base, candidate) {
  const arms = { 0x7b: 0, 0x7d: 0, 0x7f: 0 };
  let count = 0, mismatch = null;
  for (let A = 0; A < 256 && !mismatch; A++) {
    const a = base.clone(), b = base.clone();
    const aFloor = a.regs.sp;
    const tail = a.mem.read8(TASK_TAIL);       // same on both clones (from `base`)
    const slot = 0x6000 | tail;
    for (const m of [a, b]) { m.regs.a = A; m.mem.write8(slot, 0xff); } // free the slot
    oracle(a);
    candidate(b);
    count++;
    const bcode = a.mem.read8(REC + 1);
    if (bcode in arms) arms[bcode]++;
    // Cross-check the oracle's own arm consistency: E (enqueued) = B - 0x7A.
    const e = a.mem.read8((0x6000 | ((tail + 1) & 0xff)));
    if (bcode in arms) assert.equal(e, bcode - 0x7a, `oracle arm inconsistency at A=${hx(A)}: B=${hx(bcode)} E=${e}`);
    const { bad } = contractDiff(a, b, aFloor);
    if (bad) mismatch = { A, bad };
  }
  return { mismatch, arms, count };
}

// -- 1. REALISM (real captured dispatch) --------------------------------------

test("REALISM: real captured 25m 0x3e70 dispatch — game-visible RAM identical to the oracle", () => {
  const caps = captureDispatches(8, 6000);
  assert.ok(caps.length >= 1, "expected at least one real 0x3e70 dispatch during 25m attract");

  for (const entry of caps) {
    assert.equal(entry.mem.read8(BOARD), 1, "attract dispatches 0x3e70 on 25m (BOARD==1)");
    const { bad } = replay(entry, idiomatic);
    assert.equal(
      bad,
      null,
      bad && `contract diff at ${bad.addr} (oracle=${bad.a} idiomatic=${bad.b}) on A=${hx(entry.regs.a)}`,
    );
    // The dissolved idiomatic tail models no guest stack, so the oracle's tail push/ret leaves
    // a return-word residue in the dead STACK_SCRATCH — tolerated by the contract, never game-visible.
  }
  console.log(`  REALISM: ${caps.length} real 25m dispatch(es) — game-visible RAM identical to the oracle`);
});

// -- 2. ARM SELECTION (exhaustive crafted) ------------------------------------

test("ARM SELECTION (exhaustive): pickAwardTierByObjectCount == oracle over all 256 A values (all three arms)", () => {
  const base = craftedBase();
  const { mismatch, arms, count } = sweepA(base, idiomatic);
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at A=${hx(mismatch.A)}: contract diff at ${mismatch.bad.addr} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 A values");
  assert.ok(arms[0x7b] > 0 && arms[0x7d] > 0 && arms[0x7f] > 0,
    `sweep must exercise all three arms (7B=${arms[0x7b]} 7D=${arms[0x7d]} 7F=${arms[0x7f]})`);
  console.log(`  ARM/exhaustive: 256 A values — game-visible RAM identical ` +
    `(arm1/0x7B=${arms[0x7b]} arm2/0x7D=${arms[0x7d]} arm3/0x7F=${arms[0x7f]})`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): bit-ORDER swap — tests A bit 1 before A bit 0 (a wrong priority encoder). */
function brokenBitSwap(m) {
  const { regs } = m;
  if ((regs.a & 0x02) === 0) { regs.de = 0x0001; regs.b = 0x7b; }      // BUG: bit 1 tested first
  else if ((regs.a & 0x01) === 0) { regs.de = 0x0003; regs.b = 0x7d; }
  else { regs.de = 0x0005; regs.b = 0x7f; }
  loc_1e28(m);
}

/** Twin (b): wrong PARAM byte — arm 2 emits B=0x7C instead of 0x7D. */
function brokenWrongParam(m) {
  const { regs } = m;
  if ((regs.a & 0x01) === 0) { regs.de = 0x0001; regs.b = 0x7b; }
  else if ((regs.a & 0x02) === 0) { regs.de = 0x0003; regs.b = 0x7c; } // BUG: 0x7C, should be 0x7D
  else { regs.de = 0x0005; regs.b = 0x7f; }
  loc_1e28(m);
}

test("TEETH (bit-swap): the wrong priority encoder is CAUGHT by the A-sweep", () => {
  const base = craftedBase();
  const { mismatch } = sweepA(base, brokenBitSwap);
  assert.notEqual(mismatch, null, "the A-sweep FAILED to catch a bit-order swap — it is worthless");
  console.log(`  TEETH/bit-swap: caught at A=${hx(mismatch.A)} (contract diff at ${mismatch.bad.addr} ` +
    `oracle=${mismatch.bad.a} broken=${mismatch.bad.b})`);
});

test("TEETH (wrong-param): arm 2's B=0x7C twin is CAUGHT and names the record byte 0x6A31", () => {
  const base = craftedBase();
  const { mismatch } = sweepA(base, brokenWrongParam);
  assert.notEqual(mismatch, null, "the A-sweep FAILED to catch a wrong param byte — it is worthless");
  assert.equal(mismatch.bad.addr, hx(REC + 1), `expected the caught diff at 0x6A31, got ${mismatch.bad.addr}`);
  console.log(`  TEETH/wrong-param: caught at A=${hx(mismatch.A)} (0x6A31 oracle=${mismatch.bad.a} broken=${mismatch.bad.b})`);
});
