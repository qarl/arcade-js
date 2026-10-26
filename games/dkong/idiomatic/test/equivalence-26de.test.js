// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for reverseStepDirection (ROM 0x26de) — the direction-step sign
 * flip. sub_26de reads the byte at (HL) and rewrites it to +2 (0x02) when bit 7 is
 * set or -2 (0xFE) when it is clear; it is a LEAF that touches exactly one byte (a
 * read + a write, both at (HL)) and calls nothing. Its behaviour is a TOTAL function
 * of the one input byte — only bit 7 of (HL) is read — so it is gated the strongest
 * way a memory-writing leaf can be: EXHAUSTIVELY over all 256 possible (HL) values,
 * on a real captured attract machine, compared on RAM (minus the stack scratch below the entry SP) + pc + SP.
 * Every case runs on a FRESH clone (the routine WRITES memory, so no clone is reused).
 *
 * Live-out is memory-only (the byte at (HL)): the three callers read no register/flag
 * on return, and the downstream consumer sub_2523 reads the MEMORY byte, not any
 * register the oracle leaves — so the register file is deliberately NOT compared.
 *
 *   0. REACHABILITY — attract never dispatches 0x26de (sub_25f2's countdown family
 *      runs only in real gameplay). Asserted at 0, which is exactly why the gate is
 *      crafted-entry + exhaustive rather than real-dispatch. The SAME host run
 *      captures a real mid-attract machine (via 0x2333, reached on 25m) to use as the
 *      realistic base for the crafted entries.
 *
 *   1. EQUAL (exhaustive) — for each real target address (0x62A1/0x62A3/0x62A6, the
 *      addresses the real callers point HL at) sweep ALL 256 (HL) values, staged like
 *      a real call (return 0x264C on the stack), and confirm reverseStepDirection ==
 *      oracle on RAM - the stack scratch below the entry SP + pc + SP. 768 cases cover the whole input domain.
 *
 *   2. EQUAL (crafted arms) — the two explicit arms (bit 7 set -> +2, bit 7 clear ->
 *      -2), each confirmed identical to the oracle and cross-checked against the exact
 *      expected output byte + a sanity check on the oracle's ret (pc/SP).
 *
 *   3. FOOTPRINT — the oracle writes exactly ONE non-stack byte, (HL); nothing else.
 *      This licenses the "touches only (HL)" claim in the routine header.
 *
 *   4. TEETH — two deliberately-broken twins, each MUST be caught:
 *      (a) a wrong-bit twin (reads bit 6 instead of bit 7 for the sign) — a plausible
 *          off-by-one-bit bug, caught by the RAM diff wherever bit 6 != bit 7;
 *      (b) an extra-stack-pop twin (a leaked pop the direct-call routine must NOT do)
 *          — caught by the SP diff on every case.
 *
 * The idiomatic routine models the Z80 `ret` as a JS return (no stack modelling), so
 * the harness performs one m.ret() on the candidate clone AFTER the call to line pc +
 * SP up with the oracle (which rets internally). The oracle only READS the stack (the
 * ret pop), never writes it, so RAM is byte-equal on both sides regardless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-26de.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_26de as oracle } from "../../translated/loc_26de.js";
import { loc_2333 as oracle2333 } from "../../translated/loc_2333.js";
import { reverseStepDirection } from "../reverseStepDirection.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x26de;
// The addresses the real callers point HL at (sub_2602/sub_262f/sub_2679, all under sub_25f2).
const TARGET_ADDRS = [0x62a1, 0x62a3, 0x62a6];
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

/** Run the ORACLE on a fresh clone. It performs its own `ret`, so pc/SP advance. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
}

/**
 * Run a candidate on a fresh clone, then model its return with one m.ret() so pc +
 * SP match the oracle's (the idiomatic routine replaces the Z80 stack with the JS
 * call stack, so it does not touch pc/SP itself — the harness supplies the return).
 */
function runCandidate(entry, fn) {
  const c = entry.clone();
  fn(c);
  c.ret();
  return c;
}

/** Compare candidate vs oracle over RAM − the stack scratch below the entry SP + pc + SP (live-out is memory-only). */
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

// -- capture ------------------------------------------------------------------

/**
 * One host attract run that (a) counts how often 0x26de is dispatched — it never is —
 * and (b) captures a real mid-attract machine at the first 0x2333 dispatch (reached
 * on 25m) to serve as the realistic base for the crafted entries. Both hooks delegate
 * to their oracle so the host game proceeds undisturbed.
 */
function captureBaseAndCount(maxFrames) {
  let base = null;
  let count26de = 0;
  const overrides = new Map([
    [0x2333, (mm) => { if (base === null) base = mm.clone(); return oracle2333(mm); }],
    [TARGET, (mm) => { count26de++; return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return { base, count26de };
}

/**
 * A crafted entry: a real captured machine with HL pointed at a real target address,
 * the byte there set to `val`, and SP staged in STACK_SCRATCH with the real callers'
 * return address (0x264C) on top — mirroring the true call shape so pc/SP line up.
 */
function craft(base, addr, val) {
  const c = base.clone();
  c.regs.hl = addr;
  c.mem.write8(addr, val);
  c.regs.sp = 0x6bfc;
  c.mem.write8(0x6bfc, 0x4c); // return address low  (0x264C)
  c.mem.write8(0x6bfd, 0x26); // return address high
  return c;
}

// -- broken twins -------------------------------------------------------------

/** Broken twin (a): reads bit 6 of (HL) instead of bit 7 — a plausible off-by-one-bit bug. */
function brokenWrongBit(m) {
  const { regs, mem } = m;
  const v = mem.read8(regs.hl);
  mem.write8(regs.hl, (v & 0x40) ? 0x02 : 0xfe); // BUG: 0x40 should be 0x80
}

/** Broken twin (b): a leaked stack pop the direct-call idiomatic routine must not do. */
function brokenExtraPop(m) {
  const { regs, mem } = m;
  const v = mem.read8(regs.hl);
  mem.write8(regs.hl, (v & 0x80) ? 0x02 : 0xfe);
  m.pop16(); // BUG: a stray pop -> candidate SP ends 2 past the oracle's after the harness ret
}

// -- 0. REACHABILITY + base capture -------------------------------------------

let BASE = null;

test("REACHABILITY: attract never dispatches 0x26de; a real base machine is captured via 0x2333", () => {
  const { base, count26de } = captureBaseAndCount(2500);
  assert.equal(count26de, 0, `expected 0x26de to be unreached in attract, saw ${count26de} dispatches`);
  assert.ok(base, "expected a real 0x2333 dispatch during 25m attract to seed the crafted-entry base");
  BASE = base;
  console.log(`  REACHABILITY: 0x26de dispatched 0x times in 2500 attract frames; base captured at 0x2333 (SP=0x${base.regs.sp.toString(16)})`);
});

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): reverseStepDirection == oracle over all 256 (HL) values at each real target address", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");
  let count = 0;
  let firstFail = null;
  for (const addr of TARGET_ADDRS) {
    for (let v = 0; v < 256 && !firstFail; v++) {
      const entry = craft(BASE, addr, v);
      const diffs = contractDiffs(entry, reverseStepDirection); // FRESH clones inside
      count++;
      if (diffs.length) firstFail = { addr, v, diffs };
    }
  }
  assert.equal(
    firstFail,
    null,
    firstFail && `mismatch at (HL)=0x${firstFail.addr.toString(16)} value=${hx(firstFail.v)}: ${firstFail.diffs.join("; ")}`,
  );
  assert.equal(count, TARGET_ADDRS.length * 256, "must have swept the full 256-value domain at each target address");
  console.log(`  EQUAL/exhaustive: ${count} (address,value) combos identical to the oracle on RAM−STACK + pc + SP`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted arms): both sign arms (+2 / -2) match the oracle and hit the expected output byte", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");

  // Arm A: bit 7 set (currently "negative") -> +2 (0x02).
  const setEntry = craft(BASE, 0x62a3, 0x80);
  assert.equal(contractDiffs(setEntry, reverseStepDirection).length, 0, "bit-7-set arm diverged from the oracle");
  const setOut = runOracle(setEntry);
  assert.equal(setOut.mem.read8(0x62a3), 0x02, "bit-7-set input should yield +2 (0x02)");
  assert.equal(setOut.pc, 0x264c, "sanity: the oracle's ret popped the staged 0x264C return address");
  assert.equal(setOut.regs.sp, 0x6bfe, "sanity: SP advanced by 2");

  // Arm B: bit 7 clear (non-negative) -> -2 (0xFE).
  const clrEntry = craft(BASE, 0x62a3, 0x05);
  assert.equal(contractDiffs(clrEntry, reverseStepDirection).length, 0, "bit-7-clear arm diverged from the oracle");
  const clrOut = runOracle(clrEntry);
  assert.equal(clrOut.mem.read8(0x62a3), 0xfe, "bit-7-clear input should yield -2 (0xFE)");

  console.log("  EQUAL/crafted: +2 arm (in=0x80) and -2 arm (in=0x05) both identical to the oracle; ret -> pc=0x264c, SP=0x6bfe");
});

// -- 3. FOOTPRINT -------------------------------------------------------------

test("FOOTPRINT: the oracle writes exactly one non-stack byte — (HL) — and nothing else", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");
  for (const addr of TARGET_ADDRS) {
    for (const v of [0x00, 0x7f, 0x80, 0xff]) {
      const entry = craft(BASE, addr, v);
      const before = entry.dumpState();
      const after = runOracle(entry).dumpState();
      const dead = deadStackBelow(STACK_SCRATCH, entry.regs.sp);
      let touched = null, extra = false;
      for (let i = 0; i < Math.min(before.length, after.length); i++) {
        if (before[i] === after[i]) continue;
        const a = entry.stateOffsetToAddr(i);
        if (dead(a)) continue; // the ret's stack pop is not a write anyway
        if (a === addr) touched = a;
        else extra = true;
      }
      assert.equal(extra, false, `oracle wrote a non-stack byte other than (HL)=0x${addr.toString(16)} for value ${hx(v)}`);
      assert.equal(touched, addr, `oracle did not write (HL)=0x${addr.toString(16)} for value ${hx(v)}`);
    }
  }
  console.log("  FOOTPRINT: exactly one non-stack byte written per call — the target (HL) — across every arm");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: the wrong-bit twin and the extra-pop twin are CAUGHT", () => {
  assert.ok(BASE, "base machine not captured (reachability test must run first)");

  // (a) wrong-bit: caught wherever bit 6 != bit 7 (subtle — only a real sweep finds it).
  let caughtBit = 0, wrongBitCases = 0;
  for (const addr of TARGET_ADDRS) {
    for (let v = 0; v < 256; v++) {
      const entry = craft(BASE, addr, v);
      wrongBitCases++;
      if (contractDiffs(entry, brokenWrongBit).length > 0) caughtBit++;
    }
  }
  assert.ok(caughtBit > 0, "the wrong-bit twin escaped the entire sweep — the gate is worthless");

  // (b) extra-pop: caught on every case (candidate SP ends 2 past the oracle's).
  let caughtPop = 0, popCases = 0;
  for (const addr of TARGET_ADDRS) {
    for (const v of [0x00, 0x80, 0xff]) {
      const entry = craft(BASE, addr, v);
      popCases++;
      if (contractDiffs(entry, brokenExtraPop).length > 0) caughtPop++;
    }
  }
  assert.equal(caughtPop, popCases, `the extra-pop twin escaped on ${popCases - caughtPop}/${popCases} cases — the SP gate is worthless`);

  const wrongBitSample = craft(BASE, 0x62a3, 0x40); // bit 6 set, bit 7 clear -> twin diverges
  const popSample = craft(BASE, 0x62a3, 0x00);
  console.log(
    `  TEETH: wrong-bit caught on ${caughtBit}/${wrongBitCases} cases (e.g. ${contractDiffs(wrongBitSample, brokenWrongBit)[0]}); ` +
      `extra-pop caught on all ${popCases} (e.g. ${contractDiffs(popSample, brokenExtraPop)[0]})`,
  );
});
