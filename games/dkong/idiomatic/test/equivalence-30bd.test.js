// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for clearSpriteColumns (ROM 0x30bd) — the four fixed stride-4
 * clears of sprite-record X bytes in the 0x6900 shadow buffer.
 *
 * sub_30bd WRITES memory (28 bytes of 0x00, in four disjoint stride-4 runs) and takes
 * NO live-in — HL and B are loaded internally before every callee run, so the entry
 * register file is irrelevant. Its declared LIVE-OUT is memory-only: both callers
 * overwrite A right after the call (entry_128b `ld a,0x03` @0x12a6, dispatchBoardClearedInterlude
 * `ld a,(0x6227)` @0x1618) and read neither HL nor B, so the tail callee's residual
 * A/HL/B are dead, as are flags. So it is validated on RAM (minus the stack scratch below the entry SP) + pc +
 * SP via capture/clone/replay — NEVER the full register file, NEVER cycles.
 *
 * The oracle ends in a `jp 0x30e4` TAIL JUMP, so sub_30e4's `ret` returns to sub_30bd's
 * OWN caller: the oracle nets exactly ONE Z80 `ret` (pop the caller address, SP += 2).
 * The idiomatic routine models the stack with the JS call stack and does not touch
 * pc/SP, so the harness performs ONE m.ret() on the idiomatic clone AFTER the call to
 * line pc + SP up with the oracle. Every clear target is in the 0x6900 sprite buffer,
 * far from the 0x6bxx stack, so the stack region is byte-equal on both sides regardless
 * and is excluded by the contract. Every case runs on a FRESH clone (this routine writes
 * memory — a reused clone would accumulate its writes).
 *
 *   1. EQUAL (real captured dispatches) — hook 0x30bd in a real attract run and clone
 *      the machine at each true dispatch. Attract reaches it via entry_128b (first ~f2619).
 *      Oracle vs candidate on fresh clones, over RAM + pc + SP.
 *
 *   2. EQUAL (crafted, sentinel pages) — take a real capture, paint pages 0x69 and 0x6a
 *      with a sentinel, and confirm the candidate clears EXACTLY the oracle's 28-byte
 *      set (records 20-21 / 32-41 / 46-56 / 67-71, field +0) and leaves every other byte
 *      at the sentinel. This pins the precise address list a wrong (HL,B) run would miss.
 *
 *   3. EQUAL (unreached caller arm) — attract only reaches the entry_128b caller (returns
 *      to 0x12a6). Craft the dispatchBoardClearedInterlude arm by writing its return address 0x1618 to the top
 *      of the captured stack, and confirm the tail `ret` pops it identically on both sides
 *      (pc = 0x1618). Exercises the second caller without needing the L2 board-advance path.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught by the RAM contract:
 *      (a) dropped-tail-run: omits the fourth run (the tail jump), so 0x6a0c/10/14/18/1c
 *          stay at the sentinel where the oracle wrote 0 — the tail-jump-is-a-real-run bug.
 *      (b) short-third-run: uses B=10 instead of 11 for the 0x69b8 run, so 0x69e0 stays at
 *          the sentinel — an off-by-one in a run length.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-30bd.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_30bd as oracle } from "../../translated/loc_30bd.js";
import { clearSpriteColumns } from "../clearSpriteColumns.js";
import { clearStridedBytes } from "../clearStridedBytes.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x30bd;
const CAP_FRAMES = 6000; // first 0x30bd dispatch lands ~frame 2619 (via entry_128b)
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP, or null. */
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

/** Run the ORACLE on a fresh clone. Its tail jump `ret`s internally, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/** Run a candidate on a fresh clone, then model the tail-jump return with one m.ret() so pc + SP match the oracle's
 *  (the idiomatic routine replaces the Z80 stack with the JS call stack, so it does not touch pc/SP itself). */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over the memory-equivalence contract: RAM − the stack scratch below the entry SP, pc,
 *  SP. The register file and flags are deliberately NOT compared. Returns human-readable mismatches (empty when equal). */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=${ram.a} cand=${ram.b}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  return diffs;
}

// -- capture ------------------------------------------------------------------

/**
 * Hook 0x30bd in a real attract run and clone the machine at up to K real dispatches.
 * The wrapper snapshots the entry state, then runs the oracle so the host game proceeds
 * undisturbed. Single runFrames() call — frame-by-frame stepping shifts NMI timing.
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

/** Sentinel-fill a whole 256-byte page (page = high byte, e.g. 0x69) with `val`. */
function paintPage(w, page, val) {
  for (let lo = 0; lo < 0x100; lo++) w.mem.write8(((page << 8) | lo) & 0xffff, val);
}

// The exact 28-byte set the oracle clears (field +0 of four record groups).
const EXPECTED_CLEARED = [
  0x6950, 0x6954,
  0x6980, 0x6984, 0x6988, 0x698c, 0x6990, 0x6994, 0x6998, 0x699c, 0x69a0, 0x69a4,
  0x69b8, 0x69bc, 0x69c0, 0x69c4, 0x69c8, 0x69cc, 0x69d0, 0x69d4, 0x69d8, 0x69dc, 0x69e0,
  0x6a0c, 0x6a10, 0x6a14, 0x6a18, 0x6a1c,
];

// -- broken twins -------------------------------------------------------------

/** BUG: drops the fourth (tail-jump) run, leaving 0x6a0c..0x6a1c untouched. */
function teethDroppedTailRun(m) {
  const { regs } = m;
  regs.hl = 0x6950; regs.b = 0x02; clearStridedBytes(m);
  regs.hl = 0x6980; regs.b = 0x0a; clearStridedBytes(m);
  regs.hl = 0x69b8; regs.b = 0x0b; clearStridedBytes(m);
  // BUG: the 0x6a0c / B=5 run is missing.
}

/** BUG: the 0x69b8 run clears 10 bytes instead of 11, leaving 0x69e0 untouched. */
function teethShortThirdRun(m) {
  const { regs } = m;
  regs.hl = 0x6950; regs.b = 0x02; clearStridedBytes(m);
  regs.hl = 0x6980; regs.b = 0x0a; clearStridedBytes(m);
  regs.hl = 0x69b8; regs.b = 0x0a; clearStridedBytes(m); // BUG: B should be 0x0b
  regs.hl = 0x6a0c; regs.b = 0x05; clearStridedBytes(m);
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): clearSpriteColumns == oracle on every captured 0x30bd entry", () => {
  const caps = captureDispatches(64, CAP_FRAMES);
  assert.ok(caps.length >= 1, "expected at least one real 0x30bd dispatch during attract");
  for (const cap of caps) {
    const diffs = contractDiffs(cap, clearSpriteColumns); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical (RAM + pc + SP)`);
});

// -- 2. EQUAL (crafted, sentinel pages) ---------------------------------------

test("EQUAL (sentinel pages): the exact 28-byte cleared set matches the oracle", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const w = base.clone();
  paintPage(w, 0x69, 0xee);
  paintPage(w, 0x6a, 0xee);
  const diffs = contractDiffs(w, clearSpriteColumns);
  assert.equal(diffs.length, 0, `sentinel pages: ${diffs.join("; ")}`);

  // Independently confirm the oracle clears EXACTLY EXPECTED_CLEARED and nothing else in
  // pages 0x69/0x6a — so the sentinel gate above is pinning the right address list.
  const o = base.clone();
  paintPage(o, 0x69, 0xee);
  paintPage(o, 0x6a, 0xee);
  oracle(o);
  const cleared = [];
  for (let a = 0x6900; a < 0x6b00; a++) if (o.mem.read8(a) === 0x00) cleared.push(a);
  assert.deepEqual(cleared, EXPECTED_CLEARED, "oracle cleared a different set than expected");
  console.log(`  EQUAL/sentinel: ${cleared.length} bytes cleared, exactly the expected record-column set`);
});

// -- 3. EQUAL (unreached caller arm: dispatchBoardClearedInterlude return) -------------------------

test("EQUAL (dispatchBoardClearedInterlude arm): the tail ret returns to 0x1618 identically on both sides", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  // Attract only reaches the entry_128b caller (returns to 0x12a6). Rewrite the top of
  // the captured stack to dispatchBoardClearedInterlude's return address so the tail jump `ret` pops 0x1618.
  const w = base.clone();
  w.mem.write8(w.regs.sp, 0x18);
  w.mem.write8((w.regs.sp + 1) & 0xffff, 0x16);

  const diffs = contractDiffs(w, clearSpriteColumns);
  assert.equal(diffs.length, 0, `dispatchBoardClearedInterlude arm: ${diffs.join("; ")}`);
  const o = runOracle(w);
  assert.equal(o.pc, 0x1618, "the tail ret should return to dispatchBoardClearedInterlude's 0x1618");
  console.log("  EQUAL/dispatchBoardClearedInterlude: tail ret pops 0x1618 — same RAM + pc + SP on both sides");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the dropped-tail-run and short-third-run twins are CAUGHT", () => {
  const [base] = captureDispatches(1, CAP_FRAMES);
  assert.ok(base, "need one real capture to derive crafted entries from");

  const sentinel = () => {
    const w = base.clone();
    paintPage(w, 0x69, 0xee);
    paintPage(w, 0x6a, 0xee);
    return w;
  };

  const dTail = contractDiffs(sentinel(), teethDroppedTailRun);
  assert.notEqual(dTail.length, 0, "the gate FAILED to catch the dropped-tail-run twin — it is worthless");

  const dThird = contractDiffs(sentinel(), teethShortThirdRun);
  assert.notEqual(dThird.length, 0, "the gate FAILED to catch the short-third-run twin — it is worthless");

  console.log(`  TEETH: dropped-tail caught (${dTail[0]}); short-third caught (${dThird[0]})`);
});
