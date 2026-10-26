// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for bonusExpiredIdle (ROM 0x1a1e) — the idle (do-nothing) arm of
 * the bonus-expired state machine. entry_1a07 (ROM 0x1A07) dispatches an rst-0x28
 * router on BONUS_EXPIRED_STEP (0x6386, values 0..3); idx0 -> 0x1A1E is a single-byte
 * `ret`. It reads and writes NO memory and leaves NO live registers (entry_1a07 ->
 * loc_197a @0x19BF reads nothing on return, it just proceeds to the next call 0x2FCB),
 * so live-out is memory-only — in fact empty. It is gated on memory-equivalence over
 * RAM (minus the stack scratch below the entry SP) + pc + SP, and every case runs on a FRESH clone:
 *
 *   1. EQUAL (real captured dispatches) — hook 0x1a1e in a real attract run and clone
 *      the machine at each true dispatch. Attract reaches it ~1197 times over 2000
 *      frames from entry_1a07 while BONUS_EXPIRED_STEP == 0 (entry SP 0x6bea-0x6bee,
 *      all inside STACK_SCRATCH). For each capture: (a) confirm the ORACLE itself writes
 *      NO RAM (the "does nothing" claim, direct), and (b) confirm bonusExpiredIdle ==
 *      oracle on RAM - the stack scratch below the entry SP + pc + SP.
 *
 *   2. EQUAL (crafted entry) — the routine is branchless, so there are no unreached
 *      ARMS; instead the craft exercises a state the natural run never produces: SP
 *      pointed into ordinary work RAM (0x6100) with a return address staged there, so
 *      the popped bytes land in the COMPARED region rather than the dead stack. This
 *      proves the `ret`'s pop is READ-ONLY even there (no clobber of the return slot),
 *      identically both sides.
 *
 *   3. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a stray-write twin (advances BONUS_EXPIRED_STEP to 2, i.e. does the INIT
 *          arm's "advance the step" work by mistake) — caught by the RAM diff on
 *          every case;
 *      (b) an extra-stack-pop twin (a leaked stack-pop the idiomatic routine must NOT
 *          do) — caught by the SP (and usually pc) diff on every case.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs one m.ret() on the candidate clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally). The oracle only READS the stack (the
 * ret pop), never writes it, so RAM is byte-equal on both sides regardless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1a1e.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a1e as oracle } from "../../translated/loc_1a1e.js";
import { bonusExpiredIdle } from "../bonusExpiredIdle.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, BONUS_EXPIRED_STEP } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1a1e;
const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");

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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Candidate vs oracle over RAM − the stack scratch below the entry SP, pc, SP; empty when equal. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const c = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=${hx(ram.a)} cand=${hx(ram.b)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

/** RAM (minus stack) the ORACLE changed vs the pristine entry — null iff it wrote none. */
function oracleWroteRam(entry) {
  return firstRamDiff(entry, runOracle(entry), entry.regs.sp);
}

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

/**
 * Broken twin (a): a stray write — advances the router's state byte 0x6386 to 2 (it
 * does the INIT arm's "advance the step" work by mistake instead of nothing). Caught by
 * the RAM diff on every case, since the real routine leaves BONUS_EXPIRED_STEP == 0.
 */
function brokenStrayWrite(m) {
  m.mem.write8(BONUS_EXPIRED_STEP, 0x02); // BUG: the idle arm must write NOTHING
}

/**
 * Broken twin (b): a leaked stack pop — the idiomatic routine must NOT touch the Z80
 * stack, but this one pops an extra word. The harness then rets on top, so the
 * candidate advances SP by 4 (and pc to the wrong return) versus the oracle's +2.
 * Caught by the SP diff on every case.
 */
function brokenExtraPop(m) {
  m.pop16(); // BUG: a stray stack pop the direct-call idiomatic routine must not do
}

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (real dispatches): the oracle writes no RAM and bonusExpiredIdle == oracle on every captured 0x1a1e entry", () => {
  const caps = captureDispatches(64, 2000);
  assert.ok(caps.length >= 1, "expected at least one real 0x1a1e dispatch during attract");
  for (const cap of caps) {
    // sanity: attract always reaches this arm while the step is 0 (the idle state).
    assert.equal(
      cap.mem.read8(BONUS_EXPIRED_STEP), 0,
      "captured a 0x1a1e dispatch with BONUS_EXPIRED_STEP != 0 — the idle-arm premise is wrong",
    );
    // (a) the "does nothing" claim, direct: the oracle mutates no RAM.
    assert.equal(
      oracleWroteRam(cap), null,
      "oracle wrote RAM — sub_1a1e is not a memory no-op after all",
    );
    // (b) the idiomatic no-op reproduces it on RAM − the stack scratch below the entry SP + pc + SP.
    const diffs = contractDiffs(cap, bonusExpiredIdle); // FRESH clones inside — cap untouched
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  const shapes = caps.map((c) => `SP=0x${c.regs.sp.toString(16)}`);
  console.log(`  EQUAL/real: ${caps.length} captured dispatches identical; entry SPs ${[...new Set(shapes)].join(", ")}`);
});

// -- 2. EQUAL (crafted entry) -------------------------------------------------

test("EQUAL (crafted): a ret whose popped bytes land in COMPARED work RAM matches the oracle", () => {
  const caps = captureDispatches(1, 2000);
  assert.ok(caps.length >= 1, "need one real capture to seed the crafted entry with real RAM");

  // SP into ordinary work RAM (0x6100, unused board scratch) with a staged return
  // address 0x1234, so the popped bytes sit in the COMPARED region rather than the
  // dead stack — proving the pop is read-only (no clobber of the return slot).
  const craft = caps[0].clone();
  craft.mem.write8(0x6100, 0x34);
  craft.mem.write8(0x6101, 0x12);
  craft.regs.sp = 0x6100;

  const diffs = contractDiffs(craft, bonusExpiredIdle);
  assert.equal(diffs.length, 0, `crafted non-stack-SP entry: ${diffs.join("; ")}`);
  const o = runOracle(craft);
  assert.equal(o.pc, 0x1234, "sanity: the oracle's ret popped the staged 0x1234 return address");
  assert.equal(o.regs.sp, 0x6102, "sanity: SP advanced by 2");
  console.log("  EQUAL/crafted: ret with popped bytes in compared RAM (SP=0x6100 -> 0x6102, pc=0x1234) identical to the oracle");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: the stray-write twin and the extra-pop twin are CAUGHT", () => {
  const caps = captureDispatches(8, 2000);
  assert.ok(caps.length >= 1, "need real captures to run the teeth");

  // (a) stray-write: caught on every case (0x6386 becomes 0x02 vs the oracle's 0x00).
  let caughtWrite = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenStrayWrite).length > 0) caughtWrite++;
  }
  assert.equal(
    caughtWrite, caps.length,
    `the stray-write twin escaped on ${caps.length - caughtWrite}/${caps.length} real dispatches — the gate is worthless`,
  );

  // (b) extra-pop: caught on every case (candidate SP = entry+4 vs oracle entry+2).
  let caughtPop = 0;
  for (const cap of caps) {
    if (contractDiffs(cap, brokenExtraPop).length > 0) caughtPop++;
  }
  assert.equal(
    caughtPop, caps.length,
    `the extra-pop twin escaped on ${caps.length - caughtPop}/${caps.length} real dispatches — the gate is worthless`,
  );

  console.log(
    `  TEETH: stray-write caught on all ${caps.length} (e.g. ${contractDiffs(caps[0], brokenStrayWrite)[0]}); ` +
      `extra-pop caught on all ${caps.length} (e.g. ${contractDiffs(caps[0], brokenExtraPop)[0]})`,
  );
});
