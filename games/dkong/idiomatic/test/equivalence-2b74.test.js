// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b74 (ROM 0x2b74) — the reject arm of the tile-probe cascade.
 * It writes NO memory: it forces the probe's two result registers to zero (A := 0, B := 0)
 * and then UNWINDS — the oracle discards its own return address (`pop hl`) and returns one
 * extra level up (`ret`), splicing past the probe's caller. In direct-call form that
 * non-local exit is a boolean; the idiomatic routine returns false, the caller-skip signal.
 *
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the two
 * LIVE result registers A and B and the boolean unwind signal. The consumer past loc_2b1c
 * reads A (`dec a`) and B (`dec b`) straight after the unwind, so A/B are part of the
 * contract; HL and the flags are dead ABI and are NOT compared (see the routine header).
 *
 * The routine reads no input and is straight-line, so — exactly as docs/decompiler-pipeline
 * prescribes for a no-input arm — the gate is CRAFTED: a real booted attract machine, cloned,
 * with a controlled return stack staged in STACK_SCRATCH and GARBAGE loaded into A/B (to
 * prove the zeroing is real and equivalent), then oracle-vs-idiomatic on independent fresh
 * clones. There are no unreached arms and no input to sweep.
 *
 * The oracle's two-level unwind (discard own return, then ret to the grandparent) is modeled
 * on the candidate as one discarded pop + one net return, so pc + SP line up; the discarded
 * return and the popped bytes both sit in STACK_SCRATCH (excluded by contract).
 *
 *   1. EQUAL (crafted) — several (garbage-A, garbage-B, grandparent-return) cases; RAM + pc +
 *      SP + A + B identical, the idiomatic routine returns false, and the oracle's outputs are
 *      asserted (A == 0, B == 0, SP advanced by 4, pc == the staged grandparent return) so
 *      EQUAL is not vacuous and the register/stack contract is load-bearing.
 *
 *   2. TEETH — five deliberately-broken twins, each MUST be caught:
 *      (a) wrong-A     — leaves A at 1 instead of 0; caught by the A live-out check.
 *      (b) wrong-B     — leaves B at 1 instead of 0; caught by the B live-out check.
 *      (c) stray-pop   — pops an extra stack word it must not; caught by the SP diff.
 *      (d) no-unwind   — returns true instead of false; caught by the boolean signal.
 *      (e) stray-write — writes a work-RAM byte it must not; caught by the RAM diff.
 *
 *   3. REALISM — hook 0x2b74 over a long attract run; replay any real dispatch, else record
 *      that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b74.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b74 as oracle } from "../../translated/loc_2b74.js";
import { loc_2b74 } from "../loc_2b74.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b74;
const GRAND_RET = 0x1234; // the grandparent return the unwind lands on (compared both sides)
const OWN_RET = 0x2b3d;   // the "own" return the oracle discards (the probe's continuation)
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

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

/** Run the ORACLE on a fresh clone. It zeroes A/B, then `pop hl` + `ret`, so SP += 4 and
 *  pc becomes the staged grandparent return. Returns {machine, ret}. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then model the oracle's two-level unwind with one
 *  discarded pop + one net return so pc + SP align (the idiomatic routine uses the JS call
 *  stack and returns a boolean; it never touches pc/SP itself). Returns {machine, ret}. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.pop16(); // discard the own return (models the oracle's `pop hl`)
  c.ret();   // net return to the grandparent (models the oracle's `ret`)
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and the two
 *  LIVE result registers A + B. HL and the flags are dead ABI and are not compared. */
function contractDiffs(entry, fn) {
  const { c: o } = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=0x${(o.regs.a & 0xff).toString(16)} cand=0x${(c.regs.a & 0xff).toString(16)}`);
  if (o.regs.b !== c.regs.b) diffs.push(`B oracle=0x${(o.regs.b & 0xff).toString(16)} cand=0x${(c.regs.b & 0xff).toString(16)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted entry (cloned per case, never mutated).
let _base = null;
function base() {
  if (!_base) {
    const host = new Machine(ROM);
    host.runFrames(200);
    assert.equal(host.stoppedBy, null, "attract base run must reach the vblank spin cleanly");
    _base = host.clone();
  }
  return _base;
}

/** A fresh crafted entry: real attract RAM, garbage in the result registers (to prove the
 *  zeroing is real), and a controlled return stack — own return then grandparent return
 *  staged in STACK_SCRATCH. */
function craftEntry(a0, b0, grandRet = GRAND_RET) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running in isolation
  e.regs.a = a0;
  e.regs.b = b0;
  e.regs.sp = SP_TOP;
  e.push16(grandRet); // -> 0x6bfa
  e.push16(OWN_RET);  // -> 0x6bf8 (the return the oracle discards)
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** (a) wrong-A — leaves A at 1 instead of 0. */
function brokenWrongA(m) { m.regs.a = 1; m.regs.b = 0; return false; }

/** (b) wrong-B — leaves B at 1 instead of 0. */
function brokenWrongB(m) { m.regs.a = 0; m.regs.b = 1; return false; }

/** (c) stray-pop — zeroes A/B but pops an extra stack word it must not; the harness then
 *  adds its pop+ret on top, so SP ends 2 short of the oracle. */
function brokenStrayPop(m) { m.regs.a = 0; m.regs.b = 0; m.pop16(); return false; }

/** (d) no-unwind — zeroes A/B but signals "continue" (true) instead of "abort". */
function brokenNoUnwind(m) { m.regs.a = 0; m.regs.b = 0; return true; }

/** (e) stray-write — zeroes A/B but writes a work-RAM byte it must not. 0x6300 is outside
 *  STACK_SCRATCH, so the RAM diff must catch it. */
function brokenStrayWrite(m) { m.regs.a = 0; m.regs.b = 0; m.mem.write8(0x6300, 0xa5); return false; }

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): loc_2b74 == oracle on RAM+pc+SP+A+B and returns the unwind signal", () => {
  const cases = [
    { a0: 0xff, b0: 0xff },
    { a0: 0x01, b0: 0x02 },
    { a0: 0x00, b0: 0x00 }, // already zero — the zeroing must be idempotent
    { a0: 0x7b, b0: 0x91, grandRet: 0x1c08 }, // the real consumer return address
    { a0: 0x40, b0: 0x42, grandRet: 0x0000 },
  ];
  for (const { a0, b0, grandRet } of cases) {
    const entry = craftEntry(a0, b0, grandRet);

    const diffs = contractDiffs(entry, loc_2b74);
    assert.equal(diffs.length, 0, `A=${hx(a0)} B=${hx(b0)}: ${diffs.join("; ")}`);

    // The idiomatic routine must signal the unwind (caller-skip) with false.
    const { ret } = runCandidate(entry, loc_2b74);
    assert.equal(ret, false, `A=${hx(a0)} B=${hx(b0)}: idiomatic must return false (the unwind signal)`);

    // Oracle sanity — so EQUAL is not vacuous and the register/stack contract is load-bearing.
    const { c: o, ret: oret } = runOracle(entry);
    assert.equal(oret, false, "oracle must return false (the caller-skip signal)");
    assert.equal(o.regs.a & 0xff, 0, "oracle must zero A");
    assert.equal(o.regs.b & 0xff, 0, "oracle must zero B");
    assert.equal(o.regs.sp, (SP_TOP - 4 + 4) & 0xffff, "oracle must unwind SP by 4 (pop hl + ret)");
    assert.equal(o.pc, grandRet ?? GRAND_RET, "oracle must return to the staged grandparent address (two levels up)");
    assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");
  }
  console.log(`  EQUAL/crafted: ${cases.length} garbage-register cases identical on RAM+pc+SP+A+B; idiomatic returns false; oracle A=B=0, SP+4, pc->grandparent`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: wrong-A, wrong-B, stray-pop, no-unwind and stray-write twins are CAUGHT", () => {
  const entry = craftEntry(0xff, 0xff); // garbage registers so the zeroing is observable

  const wrongA = contractDiffs(entry, brokenWrongA);
  const wrongB = contractDiffs(entry, brokenWrongB);
  const strayPop = contractDiffs(entry, brokenStrayPop);
  const strayWrite = contractDiffs(entry, brokenStrayWrite);
  assert.ok(wrongA.length > 0, "the wrong-A twin escaped — the A live-out check is worthless");
  assert.ok(wrongB.length > 0, "the wrong-B twin escaped — the B live-out check is worthless");
  assert.ok(strayPop.length > 0, "the stray-pop twin escaped — the SP check is worthless");
  assert.ok(strayWrite.length > 0, "the stray-write twin escaped — the RAM diff is worthless");
  // Confirm the twins are caught where expected: the A/B registers, the SP, the RAM byte.
  assert.ok(wrongA.some((d) => d.startsWith("A ")), `wrong-A should diverge on A, got ${wrongA.join("; ")}`);
  assert.ok(wrongB.some((d) => d.startsWith("B ")), `wrong-B should diverge on B, got ${wrongB.join("; ")}`);
  assert.ok(strayPop.some((d) => d.startsWith("SP ")), `stray-pop should diverge on SP, got ${strayPop.join("; ")}`);
  assert.ok(strayWrite.some((d) => d.startsWith("RAM@0x6300")), `stray-write should diverge at 0x6300, got ${strayWrite.join("; ")}`);

  // (d) no-unwind: RAM+pc+SP+A+B are identical (the harness models the unwind either way), so
  // ONLY the boolean signal catches it.
  const goodRet = runCandidate(entry, loc_2b74).ret;
  const badRet = runCandidate(entry, brokenNoUnwind).ret;
  assert.equal(goodRet, false, "the real routine must signal unwind (false)");
  assert.notEqual(badRet, false, "the no-unwind twin escaped the boolean check — the signal is not tested");

  console.log(
    `  TEETH: wrong-A (${wrongA.find((d) => d.startsWith("A "))}), wrong-B (${wrongB.find((d) => d.startsWith("B "))}), ` +
      `stray-pop (${strayPop.find((d) => d.startsWith("SP "))}), stray-write (${strayWrite.find((d) => d.startsWith("RAM@0x6300"))}), ` +
      `no-unwind (ret ${badRet} != false) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x2b74 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, loc_2b74);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x2b74 dispatches in 8000 attract frames — the tile-probe reject arm is not reached in attract; crafted entries are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x2b74 dispatch(es) — RAM+pc+SP+A+B identical to the oracle`);
  }
});
