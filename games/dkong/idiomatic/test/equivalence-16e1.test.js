// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for endKongWalkAndAdvanceInterlude (ROM 0x16E1) — the second-stage dispatcher of the dispatchKongWalkFrame /
 * endKongWalkAndAdvanceInterlude group-walk pair. Given record #2's X (recordX) and the object's published signed
 * per-frame step (stepByte), endKongWalkAndAdvanceInterlude routes to one of three handlers:
 *
 *   recordX < 93              → loc_16ee  (reinitialize the object block, advance 0x6388)
 *   recordX ≥ 93, step ≥ 0    → loc_16d0  (schedule a reversal, then slide — bounce)
 *   recordX ≥ 93, step < 0    → stepKongWalk  (plain slide, no reversal)
 *
 * endKongWalkAndAdvanceInterlude writes no memory of its own; its callees do. Gated on
 * memory-equivalence (RAM − the stack scratch below the entry SP) on FRESH clones — never the register file (LIVE-OUT is
 * memory-only; the family tail-returns through the NMI dispatcher, which reads none of it).
 * HONEST SIGNATURE: recordX and stepByte are lifted to parameters, extracted from each crafted
 * entry's captured registers so both sides replay the same state.
 *
 * pc and SP are NOT compared. All three handlers are now idiomatic JS leaves (reinit calls
 * reloadObjectBlockAndAdvanceStep, the bounce arms reach signStepHalfRate through loc_2602), so
 * the guest-stack `ret`s the frozen handlers supplied as each route's net return are gone: the
 * candidate ends SP two below the oracle (pc at entry) — a pure seam artifact, the oracle's
 * transient pushes landing in the excluded STACK_SCRATCH; the whole-game SP guards ("FULL FLIP",
 * barrel-jump-reset) back-stop. reloadObjectBlockAndAdvanceStep is byte-identical to the frozen
 * loc_16ee unless the dispatcher mis-routes; the loc_16d0 / stepKongWalk arms lean on their own
 * proven memory-equivalence (see equivalence-16d0 / equivalence-16d5).
 *
 *   0. REACHABILITY — plain attract never dispatches 0x16e1 (0×/2500 frames, asserted): the
 *      object cascade this family drives runs only in real gameplay. So the gate is crafted-entry.
 *
 *   1. EQUAL (routing sweep) — sweep recordX over all 256 values on both step signs, at an even
 *      frame where all three handlers write DISTINCT memory (loc_16ee reinit vs loc_16d0's
 *      reload-0x80 vs stepKongWalk's plain decrement), and confirm endKongWalkAndAdvanceInterlude == oracle on every
 *      entry. Pins the exact 93 reinit threshold, the 90..92 boundary, and the sign split, and
 *      asserts each of the three arms actually fired its distinguishing memory effect.
 *
 *   2. EQUAL (FRAME sweep on the bounce arms) — recordX = 93 (a bounce), sweep FRAME over all
 *      256 on both signs, driving loc_2602's parity / 32nd-frame arms and addStrided through the
 *      dispatcher into loc_16d0 / stepKongWalk.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught by the RAM diff on entries
 *      endKongWalkAndAdvanceInterlude itself passes:
 *      (a) swapped-sign twin — sends step ≥ 0 to stepKongWalk and step < 0 to loc_16d0 (the two
 *          bounce arms exchanged), which diverges wherever the reversal matters;
 *      (b) dropped-reinit twin — never takes the reinit branch, running the bounce logic even
 *          for recordX < 93, so the reinitialized block never appears.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-16e1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16e1 as oracle } from "../../translated/loc_16e1.js";
import { endKongWalkAndAdvanceInterlude } from "../endKongWalkAndAdvanceInterlude.js";
import { loc_16d0 } from "../loc_16d0.js";
import { stepKongWalk } from "../stepKongWalk.js";
import { loc_16ee } from "../../translated/loc_16ee.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x16e1;
const FRAME_ADDR = 0x601a;
const CD_ADDR = 0x62a0; // object #1 even-frame countdown
const DIR_ADDR = 0x62a1; // object #1 signed step-direction (bit7 = sign)
const STEP_ADDR = 0x6388; // the counter loc_16ee's reinit arm advances
const BLOCK = 0x6908; // SPRITE_OBJ_BLOCK — 10 records × 4 bytes; byte +0 = X
const REINIT_TAG = 0x690c; // loc_16ee overwrites this byte to 0x66 after reinitializing the block
const P_ADDR = 0x69e5;
const P4_ADDR = 0x69e9;
const SAFE_SP = 0x6bfe; // deep in STACK_SCRATCH — the oracle handlers' transient pushes are excluded

const REINIT_MARK = 93; // recordX below this reinitializes; at/above it bounces/slides

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

/** Run the ORACLE on a fresh clone; the chosen handler performs the single net `ret`. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, passing the honest inputs extracted from the entry's
 * captured registers (recordX = A, stepByte = C) — exactly the values the oracle reads — so the
 * gate replays the same real state on both sides.
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c, c.regs.a, c.regs.c);
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
 * A crafted entry: a real booted machine with the routing inputs placed in the registers the
 * dispatcher reads (recordX → A, stepByte → C), plus the object's motion state (FRAME, the
 * even-frame countdown, the step-direction, the block X fields, and loc_2602's sprite-pair
 * counters) poked to a chosen configuration. SP is staged deep in STACK_SCRATCH so the oracle
 * handlers' transient pushes are excluded from the RAM diff. Undefined fields keep the booted byte.
 */
function craft(seed, { recordX, stepByte, frame, cd, dir, blockX, p, p4 }) {
  const e = seed.clone();
  if (recordX !== undefined) e.regs.a = recordX;
  if (stepByte !== undefined) e.regs.c = stepByte;
  if (frame !== undefined) e.mem.write8(FRAME_ADDR, frame);
  if (cd !== undefined) e.mem.write8(CD_ADDR, cd);
  if (dir !== undefined) e.mem.write8(DIR_ADDR, dir);
  if (blockX !== undefined) {
    for (let i = 0; i < 10; i++) e.mem.write8(BLOCK + i * 4, blockX);
  }
  if (p !== undefined) e.mem.write8(P_ADDR, p);
  if (p4 !== undefined) e.mem.write8(P4_ADDR, p4);
  e.regs.sp = SAFE_SP;
  return e;
}

// -- broken twins -------------------------------------------------------------

/** Broken twin (a): the two bounce arms exchanged — reverses on the wrong step sign. */
function brokenSwapSign(m, recordX, stepByte) {
  if (recordX < REINIT_MARK) { loc_16ee(m); return; }
  const stepIsNegative = (stepByte & 0x80) !== 0;
  if (stepIsNegative) loc_16d0(m); else stepKongWalk(m); // BUG: sign test inverted
}

/** Broken twin (b): never reinitializes — runs the bounce logic even below the reinit mark. */
function brokenDropReinit(m, recordX, stepByte) {
  const stepIsNegative = (stepByte & 0x80) !== 0; // BUG: reinit branch dropped entirely
  if (!stepIsNegative) loc_16d0(m); else stepKongWalk(m);
}

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: attract never dispatches 0x16e1 (crafted-entry gate)", () => {
  let count = 0;
  const overrides = new Map([[TARGET, (mm) => { count++; return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(2500);
  assert.equal(count, 0, `expected 0x16e1 to be unreached in attract, saw ${count} dispatches`);
  console.log(`  REACHABILITY: 0x16e1 dispatched 0× in 2500 attract frames — crafted-entry gate justified`);
});

// -- 1. EQUAL (routing sweep) -------------------------------------------------

test("EQUAL (routing sweep): endKongWalkAndAdvanceInterlude == oracle over all 256 recordX × both step signs", () => {
  const seed = bootedMachine(400).clone();
  // Even frame, countdown seeded 0x08: the three handlers leave 0x62A0 distinct — loc_16ee
  // reinitializes the block (writes 0x690C=0x66), loc_16d0 arms→underflow→reload 0x62A0=0x80,
  // stepKongWalk plain-decrements 0x62A0 to 0x07 — so a mis-route cannot hide.
  const base = { frame: 0x00, cd: 0x08, blockX: 0x40, p: 0x51, p4: 0xd1 };
  let count = 0, mismatch = null;
  for (const [stepByte, dir] of [[0x05, 0x05], [0x85, 0x85]]) {
    for (let recordX = 0; recordX < 256 && !mismatch; recordX++) {
      const e = craft(seed, { recordX, stepByte, dir, ...base });
      const diffs = contractDiffs(e, endKongWalkAndAdvanceInterlude);
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

  // Prove each of the three arms actually fired its distinguishing memory effect, and that the
  // reinit threshold sits exactly at 93 (92 reinitializes, 93 bounces).
  const reinit = runOracle(craft(seed, { recordX: 92, stepByte: 0x05, dir: 0x05, ...base }));
  assert.equal(reinit.mem.read8(REINIT_TAG), 0x66, "recordX 92 (<93) must reinitialize the block (0x690C=0x66)");
  const bouncePos = runOracle(craft(seed, { recordX: 93, stepByte: 0x05, dir: 0x05, ...base }));
  assert.equal(bouncePos.mem.read8(CD_ADDR), 0x80, "recordX 93, positive step must take loc_16d0 (even-frame reload 0x62A0=0x80)");
  assert.notEqual(bouncePos.mem.read8(REINIT_TAG), 0x66, "recordX 93 must NOT reinitialize (bounce arm, not loc_16ee)");
  const bounceNeg = runOracle(craft(seed, { recordX: 93, stepByte: 0x85, dir: 0x85, ...base }));
  assert.equal(bounceNeg.mem.read8(CD_ADDR), 0x07, "recordX 93, negative step must take stepKongWalk (plain decrement 0x62A0=0x07)");
  console.log(`  EQUAL/routing-sweep: ${count} (recordX × sign) entries identical; all three arms + the 92/93 threshold confirmed`);
});

// -- 2. EQUAL (FRAME sweep on the bounce arms) --------------------------------

test("EQUAL (FRAME sweep): recordX=93 bounce arms match the oracle over all 256 FRAME values", () => {
  const seed = bootedMachine(400).clone();
  let count = 0, mismatch = null;
  for (const [stepByte, dir] of [[0x05, 0x05], [0x85, 0x85]]) {
    for (let frame = 0; frame < 256 && !mismatch; frame++) {
      const e = craft(seed, { recordX: 93, stepByte, frame, cd: 0x08, dir, blockX: 0x40, p: 0x51, p4: 0xd1 });
      const diffs = contractDiffs(e, endKongWalkAndAdvanceInterlude);
      count++;
      if (diffs.length) { mismatch = { frame, stepByte, diffs }; break; }
    }
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at FRAME=${hx(mismatch.frame)} stepByte=${hx(mismatch.stepByte)}: ${mismatch.diffs.join("; ")}`,
  );
  assert.equal(count, 256 * 2, "must have swept all 256 FRAME values on both bounce arms");
  // Confirm the drive is live: an odd frame with a positive step slides block X byte +0 by +1.
  const odd = runOracle(craft(seed, { recordX: 93, stepByte: 0x05, frame: 0x03, cd: 0x08, dir: 0x05, blockX: 0x40 }));
  assert.equal(odd.mem.read8(BLOCK), 0x41, "odd-frame positive-step bounce must shift block X byte +0 from 0x40 to 0x41");
  console.log(`  EQUAL/frame-sweep: ${count} (FRAME × sign) bounce entries identical; odd-frame slide confirmed live`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: swapped-sign and dropped-reinit twins are CAUGHT (endKongWalkAndAdvanceInterlude passes the same entries)", () => {
  const seed = bootedMachine(400).clone();
  const base = { frame: 0x00, cd: 0x08, blockX: 0x40, p: 0x51, p4: 0xd1 };

  // Swapped-sign twin: on the bounce arms (recordX ≥ 93) it picks the wrong handler. loc_16d0
  // and stepKongWalk leave 0x62A0 distinct on an even frame (0x80 vs 0x07), so every bounce entry diverges.
  let swapCases = 0, swapCaught = 0;
  for (const stepByte of [0x05, 0x85]) {
    for (const recordX of [93, 100, 0x80, 0xff]) {
      const e = craft(seed, { recordX, stepByte, dir: stepByte, ...base });
      swapCases++;
      if (contractDiffs(e, brokenSwapSign).length > 0) swapCaught++;
      assert.equal(contractDiffs(e, endKongWalkAndAdvanceInterlude).length, 0, `endKongWalkAndAdvanceInterlude must pass recordX=${hx(recordX)} stepByte=${hx(stepByte)}`);
    }
  }
  assert.equal(swapCaught, swapCases, `swapped-sign twin escaped ${swapCases - swapCaught}/${swapCases} bounce entries`);

  // Dropped-reinit twin: on the reinit arm (recordX < 93) it slides instead of reinitializing,
  // so the reinit tag 0x690C=0x66 (and the ldir'd block, and the 0x6388 advance) never appear.
  let dropCases = 0, dropCaught = 0;
  for (const stepByte of [0x05, 0x85]) {
    for (const recordX of [0x00, 0x50, 90, 92]) {
      const e = craft(seed, { recordX, stepByte, dir: stepByte, ...base });
      dropCases++;
      if (contractDiffs(e, brokenDropReinit).length > 0) dropCaught++;
      assert.equal(contractDiffs(e, endKongWalkAndAdvanceInterlude).length, 0, `endKongWalkAndAdvanceInterlude must pass recordX=${hx(recordX)} stepByte=${hx(stepByte)}`);
    }
  }
  assert.equal(dropCaught, dropCases, `dropped-reinit twin escaped ${dropCases - dropCaught}/${dropCases} reinit entries`);

  console.log(
    `  TEETH: swapped-sign twin caught on all ${swapCases} bounce entries; ` +
      `dropped-reinit twin caught on all ${dropCases} reinit entries`,
  );
});
