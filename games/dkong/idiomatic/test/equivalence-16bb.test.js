// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for dispatchKongWalkFrame (ROM 0x16BB) — the first-stage dispatcher of the dispatchKongWalkFrame /
 * endKongWalkAndAdvanceInterlude group-walk pair. Every frame it pre-clears object #1's even-frame countdown
 * (0x62A0 := 0), reads record #2's X (recordX, at 0x6910) and the object's published signed
 * per-frame step (stepByte, at 0x63A3), and routes:
 *
 *   recordX ≥ 90                     → endKongWalkAndAdvanceInterlude  (hand to the at-rail reinit/bounce dispatcher)
 *   recordX < 90, step < 0           → loc_16d0  (schedule a reversal, then slide — bounce)
 *   recordX < 90, step ≥ 0           → stepKongWalk  (plain slide, no reversal)
 *
 * NOTE recordX IS block record #2's X (0x6910 == SPRITE_OBJ_BLOCK + 8), read from MEMORY not a
 * register (unlike endKongWalkAndAdvanceInterlude). With 0x62A0 pre-cleared to 0 the three arms leave DISTINCT
 * memory on an even frame (stepKongWalk: 0x62A0 0→0xFF; loc_16d0: reload 0x80 + reverse 0x62A1;
 * reinit: block 0x690C=0x66, 0x62A0 stays 0), so a mis-route cannot hide.
 *
 * dispatchKongWalkFrame writes only the 0x62A0 pre-clear; its callees do the rest. Gated on
 * memory-equivalence (RAM − the stack scratch below the entry SP) on FRESH clones — never the register file (LIVE-OUT is
 * memory-only; the family tail-returns through the NMI dispatcher, which reads none of it).
 *
 * pc and SP are NOT compared. Every route's callees are now idiomatic JS leaves (reinit calls
 * reloadObjectBlockAndAdvanceStep, the motion arms reach signStepHalfRate through loc_2602), so
 * the guest-stack `ret`s the frozen callees supplied as each route's net return are gone: the
 * candidate ends SP two below the oracle (pc at entry) — a pure seam artifact, the oracle's
 * transient pushes landing in the excluded STACK_SCRATCH; the whole-game SP guards ("FULL FLIP",
 * barrel-jump-reset) back-stop. reloadObjectBlockAndAdvanceStep is byte-identical to the frozen
 * loc_16ee unless the dispatcher mis-routes; the loc_16d0 / stepKongWalk arms lean on their own
 * proven memory-equivalence (see equivalence-16d0 / -16d5 / -16e1).
 *
 *   0. REACHABILITY — plain attract never dispatches 0x16bb (0×/2500 frames, asserted): the
 *      object cascade this family drives runs only in real gameplay. So the gate is crafted-entry.
 *
 *   1. EQUAL (routing sweep) — sweep recordX over all 256 values on both step signs, at an even
 *      frame where the three arms write DISTINCT memory, and confirm dispatchKongWalkFrame == oracle on every
 *      entry. Pins the 90 hand-off boundary (89 vs 90), the 93 reinit threshold inside endKongWalkAndAdvanceInterlude
 *      (92 reinit vs 93 bounce/slide), and the below-rail sign split, and asserts each arm fired
 *      its distinguishing memory effect.
 *
 *   2. EQUAL (FRAME sweep on the below-rail arms) — recordX = 0x40, sweep FRAME over all 256 on
 *      both signs, driving loc_2602's parity / 32nd-frame arms and addStrided through loc_16d0 /
 *      stepKongWalk.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught by the RAM diff on entries
 *      dispatchKongWalkFrame itself passes:
 *      (a) swapped-sign twin — sends the below-rail step ≥ 0 to loc_16d0 and step < 0 to stepKongWalk
 *          (the two below-rail arms exchanged), which diverges wherever the reversal matters;
 *      (b) dropped-clear twin — never pre-clears 0x62A0, so loc_2602 decrements the stale crafted
 *          countdown instead of 0 (and the reinit arm leaves it stale), diverging at 0x62A0.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-16bb.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16bb as oracle } from "../../translated/loc_16bb.js";
import { dispatchKongWalkFrame } from "../dispatchKongWalkFrame.js";
import { loc_16d0 } from "../loc_16d0.js";
import { stepKongWalk } from "../stepKongWalk.js";
import { endKongWalkAndAdvanceInterlude } from "../endKongWalkAndAdvanceInterlude.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x16bb;
const FRAME_ADDR = 0x601a;
const CD_ADDR = 0x62a0;   // object #1 even-frame countdown (pre-cleared by dispatchKongWalkFrame)
const DIR_ADDR = 0x62a1;  // object #1 signed step-direction (bit7 = sign)
const STEP_ADDR = 0x63a3; // the published signed per-frame step (stepByte)
const RX_ADDR = 0x6910;   // record #2's X == SPRITE_OBJ_BLOCK + 8 (recordX)
const BLOCK = 0x6908;     // SPRITE_OBJ_BLOCK — 10 records × 4 bytes; byte +0 = X
const REINIT_TAG = 0x690c; // loc_16ee overwrites this byte to 0x66 after reinitializing the block
const P_ADDR = 0x69e5;
const P4_ADDR = 0x69e9;
const SAFE_SP = 0x6bfe; // deep in STACK_SCRATCH — the oracle handlers' transient pushes are excluded

const HANDOFF_MARK = 90; // recordX at/above this hands to endKongWalkAndAdvanceInterlude; below, dispatchKongWalkFrame decides
const REINIT_MARK = 93;  // inside endKongWalkAndAdvanceInterlude: below reinitializes, at/above bounces/slides

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP. */
function firstRamDiff(a, b, liveFloor) {
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

/** Run the ORACLE on a fresh clone; the chosen route performs the single net `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone. dispatchKongWalkFrame reads its inputs from memory — no register args. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  return c;
}

/** Compare candidate vs oracle over the memory-equivalence contract: RAM − the stack scratch below the entry SP. No
 *  pc/SP (a seam artifact of the dissolved calls — see the header); live-out is memory-only. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/** A realistic booted machine, a few hundred attract frames in. */
function bootedMachine(maxFrames) {
  const m = new Machine(ROM);
  m.runFrames(maxFrames);
  return m;
}

/**
 * A crafted entry: a real booted machine with the routing inputs written to the memory the
 * dispatcher reads (recordX → 0x6910, stepByte → 0x63A3), plus the object's motion state (FRAME,
 * the even-frame countdown, the step-direction, the block X fields, and loc_2602's sprite-pair
 * counters). recordX is written LAST because it IS block record #2's X (0x6910) — the block fill
 * would otherwise clobber it. SP is staged deep in STACK_SCRATCH so the oracle handlers' transient
 * pushes are excluded from the RAM diff. Undefined fields keep the booted byte.
 */
function craft(seed, { recordX, stepByte, frame, cd, dir, blockX, p, p4 }) {
  const e = seed.clone();
  if (blockX !== undefined) {
    for (let i = 0; i < 10; i++) e.mem.write8(BLOCK + i * 4, blockX);
  }
  if (stepByte !== undefined) e.mem.write8(STEP_ADDR, stepByte);
  if (frame !== undefined) e.mem.write8(FRAME_ADDR, frame);
  if (cd !== undefined) e.mem.write8(CD_ADDR, cd);
  if (dir !== undefined) e.mem.write8(DIR_ADDR, dir);
  if (p !== undefined) e.mem.write8(P_ADDR, p);
  if (p4 !== undefined) e.mem.write8(P4_ADDR, p4);
  if (recordX !== undefined) e.mem.write8(RX_ADDR, recordX); // LAST: recordX is block[2].X
  e.regs.sp = SAFE_SP;
  return e;
}

// -- broken twins -------------------------------------------------------------

/** Broken twin (a): the two below-rail arms exchanged — bounces on the wrong step sign. */
function brokenSwapSign(m) {
  const { mem } = m;
  mem.write8(CD_ADDR, 0x00);
  const stepByte = mem.read8(STEP_ADDR);
  const recordX = mem.read8(RX_ADDR);
  if (recordX >= HANDOFF_MARK) { endKongWalkAndAdvanceInterlude(m, recordX, stepByte); return; }
  const stepIsNegative = (stepByte & 0x80) !== 0;
  if (!stepIsNegative) loc_16d0(m); else stepKongWalk(m); // BUG: below-rail sign test inverted
}

/** Broken twin (b): never pre-clears 0x62A0 — loc_2602 decrements the stale countdown. */
function brokenDropClear(m) {
  const { mem } = m;
  // BUG: the `xor a / ld (0x62A0),a` pre-clear is dropped entirely.
  const stepByte = mem.read8(STEP_ADDR);
  const recordX = mem.read8(RX_ADDR);
  if (recordX >= HANDOFF_MARK) { endKongWalkAndAdvanceInterlude(m, recordX, stepByte); return; }
  const stepIsNegative = (stepByte & 0x80) !== 0;
  if (stepIsNegative) loc_16d0(m); else stepKongWalk(m);
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: attract never dispatches 0x16bb (crafted-entry gate)", () => {
  let count = 0;
  const overrides = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.equal(count, 0, `expected 0x16bb to be unreached in attract, saw ${count} dispatches`);
  console.log(`  REACHABILITY: 0x16bb dispatched 0× in 2500 attract frames — crafted-entry gate justified`);
});

// -- 1. EQUAL (routing sweep) -------------------------------------------------

test("EQUAL (routing sweep): dispatchKongWalkFrame == oracle over all 256 recordX × both step signs", () => {
  const seed = bootedMachine(400).clone();
  // Even frame, countdown seeded 0x08: after the pre-clear the three arms leave 0x62A0 distinct —
  // stepKongWalk lets loc_2602 wrap it 0 -> 0xFF, loc_16d0 arms->reload 0x62A0=0x80, loc_16ee leaves
  // the pre-cleared 0 and tags 0x690C=0x66.
  const base = { frame: 0x00, cd: 0x08, blockX: 0x40, p: 0x51, p4: 0xd1 };
  let count = 0, mismatch = null;
  for (const [stepByte, dir] of [[0x05, 0x05], [0x85, 0x85]]) {
    for (let recordX = 0; recordX < 256 && !mismatch; recordX++) {
      const e = craft(seed, { recordX, stepByte, dir, ...base });
      const diffs = contractDiffs(e, dispatchKongWalkFrame);
      count++;
      if (diffs.length) { mismatch = { recordX, stepByte, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch &&
      `mismatch at recordX=${hx(mismatch.recordX)} stepByte=${hx(mismatch.stepByte)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 recordX on both step signs");

  // Prove each arm fired its distinguishing effect and pin both boundaries (89/90 hand-off,
  // 92/93 reinit threshold inside endKongWalkAndAdvanceInterlude).
  const belowPos = runOracle(craft(seed, { recordX: 89, stepByte: 0x05, dir: 0x05, ...base }));
  assert.equal(belowPos.mem.read8(CD_ADDR), 0xff, "recordX 89 (<90), positive step must take stepKongWalk (0x62A0 wraps to 0xFF)");
  const belowNeg = runOracle(craft(seed, { recordX: 89, stepByte: 0x85, dir: 0x85, ...base }));
  assert.equal(belowNeg.mem.read8(CD_ADDR), 0x80, "recordX 89 (<90), negative step must take loc_16d0 (reload 0x62A0=0x80)");
  const reinit = runOracle(craft(seed, { recordX: 92, stepByte: 0x05, dir: 0x05, ...base }));
  assert.equal(reinit.mem.read8(REINIT_TAG), 0x66, "recordX 92 (90..92) must reinitialize the block (0x690C=0x66)");
  assert.equal(reinit.mem.read8(CD_ADDR), 0x00, "reinit arm leaves 0x62A0 at the pre-cleared 0");
  const bouncePos = runOracle(craft(seed, { recordX: 93, stepByte: 0x05, dir: 0x05, ...base }));
  assert.equal(bouncePos.mem.read8(CD_ADDR), 0x80, "recordX 93, positive step must reach loc_16d0 via endKongWalkAndAdvanceInterlude (0x62A0=0x80)");
  assert.notEqual(bouncePos.mem.read8(REINIT_TAG), 0x66, "recordX 93 must NOT reinitialize (bounce arm, not loc_16ee)");
  const bounceNeg = runOracle(craft(seed, { recordX: 93, stepByte: 0x85, dir: 0x85, ...base }));
  assert.equal(bounceNeg.mem.read8(CD_ADDR), 0xff, "recordX 93, negative step must reach stepKongWalk via endKongWalkAndAdvanceInterlude (0x62A0=0xFF)");
  console.log(`  EQUAL/routing-sweep: ${count} (recordX × sign) entries identical; all three arms + the 89/90 + 92/93 boundaries confirmed`);
});

// -- 2. EQUAL (FRAME sweep on the below-rail arms) ----------------------------

test("EQUAL (FRAME sweep): recordX=0x40 below-rail arms match the oracle over all 256 FRAME values", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  for (const [stepByte, dir] of [[0x05, 0x05], [0x85, 0x85]]) {
    for (let frame = 0; frame < 256 && !mismatch; frame++) {
      const e = craft(seed, { recordX: 0x40, stepByte, frame, cd: 0x08, dir, blockX: 0x40, p: 0x51, p4: 0xd1 });
      const diffs = contractDiffs(e, dispatchKongWalkFrame);
      count++;
      if (diffs.length) { mismatch = { frame, stepByte, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at FRAME=${hx(mismatch.frame)} stepByte=${hx(mismatch.stepByte)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 FRAME values on both below-rail arms");
  // Confirm the drive is live: an odd frame with a positive step (stepKongWalk) slides block X byte +0.
  const odd = runOracle(craft(seed, { recordX: 0x40, stepByte: 0x05, frame: 0x03, cd: 0x08, dir: 0x05, blockX: 0x40 }));
  assert.equal(odd.mem.read8(BLOCK), 0x41, "odd-frame positive-step slide must shift block X byte +0 from 0x40 to 0x41");
  console.log(`  EQUAL/frame-sweep: ${count} (FRAME × sign) below-rail entries identical; odd-frame slide confirmed live`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: swapped-sign and dropped-clear twins are CAUGHT (dispatchKongWalkFrame passes the same entries)", () => {
  const seed = bootedMachine(400).clone();
  const base = { frame: 0x00, cd: 0x08, blockX: 0x40, p: 0x51, p4: 0xd1 };

  // Swapped-sign twin: on the below-rail arms (recordX < 90) it picks the wrong handler. loc_16d0
  // and stepKongWalk leave 0x62A0 distinct on an even frame (0x80 vs 0xFF), so every below-rail entry diverges.
  let swapCases = 0, swapCaught = 0;
  for (const [stepByte, dir] of [[0x05, 0x05], [0x85, 0x85]]) {
    for (const recordX of [0x00, 0x40, 0x50, 89]) {
      const e = craft(seed, { recordX, stepByte, dir, ...base });
      swapCases++;
      if (contractDiffs(e, brokenSwapSign).length > 0) swapCaught++;
      assert.equal(contractDiffs(e, dispatchKongWalkFrame).length, 0, `dispatchKongWalkFrame must pass recordX=${hx(recordX)} stepByte=${hx(stepByte)}`);
    }
  }
  assert.equal(swapCaught, swapCases, `swapped-sign twin escaped ${swapCases - swapCaught}/${swapCases} below-rail entries`);

  // Dropped-clear twin: never pre-clears 0x62A0. The pre-clear is load-bearing on the stepKongWalk
  // (below-rail positive) and loc_16ee (reinit) arms — there the final 0x62A0 depends on it
  // (loc_2602 wraps 0 -> 0xFF vs the stale 0x08 -> 0x07; the reinit arm leaves it 0 vs 0x08). It
  // is REDUNDANT on the loc_16d0 arm, which overwrites 0x62A0 := 1 itself, so that arm is excluded.
  let dropCases = 0, dropCaught = 0;
  for (const recordX of [0x00, 0x40, 89]) { // positive below-rail -> stepKongWalk
    const e = craft(seed, { recordX, stepByte: 0x05, dir: 0x05, ...base });
    dropCases++;
    if (contractDiffs(e, brokenDropClear).length > 0) dropCaught++;
    assert.equal(contractDiffs(e, dispatchKongWalkFrame).length, 0, `dispatchKongWalkFrame must pass recordX=${hx(recordX)} stepByte=0x05`);
  }
  for (const recordX of [90, 91, 92]) { // reinit -> loc_16ee (both signs)
    for (const stepByte of [0x05, 0x85]) {
      const e = craft(seed, { recordX, stepByte, dir: stepByte, ...base });
      dropCases++;
      if (contractDiffs(e, brokenDropClear).length > 0) dropCaught++;
      assert.equal(contractDiffs(e, dispatchKongWalkFrame).length, 0, `dispatchKongWalkFrame must pass recordX=${hx(recordX)} stepByte=${hx(stepByte)}`);
    }
  }
  assert.equal(dropCaught, dropCases, `dropped-clear twin escaped ${dropCases - dropCaught}/${dropCases} load-bearing entries`);

  console.log(
    `  TEETH: swapped-sign twin caught on all ${swapCases} below-rail entries; ` +
      `dropped-clear twin caught on all ${dropCases} entries`,
  );
});
