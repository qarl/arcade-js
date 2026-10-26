// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for enterBoardAdvanceAndUnwind (ROM 0x1e85) — the shared board-complete
 * tail of Mario's position check (sub_1e57). It writes GAME_SUBSTATE (0x600A) := 0x16 (the
 * board-cleared/advance sub-state) and then UNWINDS: the oracle discards its own return
 * address (`pop hl`) and returns one extra level up (`ret`), aborting the movement cascade.
 * In direct-call form that non-local exit is a boolean — the idiomatic routine returns
 * false, the caller-skip signal.
 *
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the
 * boolean unwind signal. Live-out is memory-only otherwise (see the routine header).
 *
 * A long attract run dispatches 0x1e85 ZERO times (attract never completes a board / never
 * rescues Pauline), so — exactly as docs/decompiler-pipeline prescribes for arms attract
 * never reaches — the gate is CRAFTED: a real booted attract machine, cloned, with a
 * controlled return stack staged in STACK_SCRATCH and GAME_SUBSTATE poked to a non-0x16
 * sentinel, then oracle-vs-idiomatic on independent fresh clones. The routine reads no
 * memory and is straight-line, so there are no unreached arms and no input to sweep.
 *
 * The oracle's two-level unwind (discard own return, then ret to the grandparent) is
 * modeled on the candidate as one discarded pop + one net return, so pc + SP line up; the
 * discarded return and the popped bytes both sit in STACK_SCRATCH (excluded by contract).
 *
 *   1. EQUAL (crafted) — several GAME_SUBSTATE sentinels; RAM + pc + SP identical, the
 *      idiomatic routine returns false, and the oracle's outputs are asserted (0x600A ==
 *      0x16, SP advanced by 4, pc == the staged grandparent return) so EQUAL is not vacuous
 *      and the stack exclusion is load-bearing.
 *
 *   2. TEETH — four deliberately-broken twins, each MUST be caught:
 *      (a) dropped-write — never writes GAME_SUBSTATE; caught by the RAM diff at 0x600A.
 *      (b) wrong-substate — writes 0x17 instead of 0x16; caught by the RAM diff at 0x600A.
 *      (c) stray-pop — pops an extra stack word it must not; caught by the SP diff.
 *      (d) no-unwind — returns true instead of false; caught by the boolean signal check.
 *
 *   3. REALISM — hook 0x1e85 over a long attract run; replay any real dispatch, else record
 *      that attract never reaches it (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1e85.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1e85 as oracle } from "../../translated/loc_1e85.js";
import { enterBoardAdvanceAndUnwind } from "../enterBoardAdvanceAndUnwind.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, GAME_SUBSTATE } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1e85;
const BOARD_ADVANCE_SUBSTATE = 0x16;
const GRAND_RET = 0x1234; // the grandparent return the unwind lands on (compared both sides)
const OWN_RET = 0x1e84;   // the "own" return the oracle discards (sub_1e57's continuation)
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

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

/** Run the ORACLE on a fresh clone. It does `pop hl` then `ret`, so SP += 4 and pc becomes
 *  the staged grandparent return. */
function runOracle(entry) {
  const c = entry.clone();
  oracle(c);
  return c;
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

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP. */
function contractDiffs(entry, fn) {
  const o = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  return diffs;
}

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated).
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

/** A fresh crafted entry: real attract RAM, a controlled return stack (own return then
 *  grandparent return staged in STACK_SCRATCH), and GAME_SUBSTATE poked to a sentinel. */
function craftEntry(substate) {
  const e = base().clone();
  e.regs.sp = SP_TOP;
  e.push16(GRAND_RET); // -> 0x6bfa
  e.push16(OWN_RET);   // -> 0x6bf8 (the return the oracle discards)
  e.mem.write8(GAME_SUBSTATE, substate);
  return e;
}

/** (a) dropped-write — never writes GAME_SUBSTATE. */
function brokenDropWrite() { return false; }

/** (b) wrong-substate — writes 0x17 instead of 0x16. */
function brokenWrongSubstate(m) { m.mem.write8(GAME_SUBSTATE, 0x17); return false; }

/** (c) stray-pop — writes the right byte but pops an extra stack word it must not; the
 *  harness then adds its pop+ret on top, so SP ends 2 short of the oracle. */
function brokenStrayPop(m) { m.mem.write8(GAME_SUBSTATE, BOARD_ADVANCE_SUBSTATE); m.pop16(); return false; }

/** (d) no-unwind — writes the right byte but signals "continue" (true) instead of "abort". */
function brokenNoUnwind(m) { m.mem.write8(GAME_SUBSTATE, BOARD_ADVANCE_SUBSTATE); return true; }

// -- 1. EQUAL (crafted) -------------------------------------------------------

test("EQUAL (crafted): enterBoardAdvanceAndUnwind == oracle on RAM+pc+SP and returns the unwind signal", () => {
  const sentinels = [0x0c, 0x0d, 0x00, 0xff, 0x08];
  for (const s of sentinels) {
    const entry = craftEntry(s);

    const diffs = contractDiffs(entry, enterBoardAdvanceAndUnwind);
    assert.equal(diffs.length, 0, `sentinel ${hx(s)}: ${diffs.join("; ")}`);

    // The idiomatic routine must signal the unwind (caller-skip) with false.
    const { ret } = runCandidate(entry, enterBoardAdvanceAndUnwind);
    assert.equal(ret, false, `sentinel ${hx(s)}: idiomatic must return false (the unwind signal)`);

    // Oracle sanity — so EQUAL is not vacuous and the stack exclusion is load-bearing.
    const o = runOracle(entry);
    assert.equal(o.mem.read8(GAME_SUBSTATE), BOARD_ADVANCE_SUBSTATE, "oracle must set GAME_SUBSTATE := 0x16");
    assert.equal(o.regs.sp, (SP_TOP - 4 + 4) & 0xffff, "oracle must unwind SP by 4 (pop hl + ret)");
    assert.equal(o.pc, GRAND_RET, "oracle must return to the staged grandparent address (two levels up)");
    assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");
  }
  console.log(`  EQUAL/crafted: ${sentinels.length} sentinels identical on RAM+pc+SP; idiomatic returns false; oracle 0x600A:=0x16, SP+4, pc->grandparent`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: dropped-write, wrong-substate, stray-pop and no-unwind twins are CAUGHT", () => {
  const entry = craftEntry(0x0c); // sentinel != 0x16 so the write is observable

  const dropWrite = contractDiffs(entry, brokenDropWrite);
  const wrongSub = contractDiffs(entry, brokenWrongSubstate);
  const strayPop = contractDiffs(entry, brokenStrayPop);
  assert.ok(dropWrite.length > 0, "the dropped-write twin escaped — the gate is worthless");
  assert.ok(wrongSub.length > 0, "the wrong-substate twin escaped — the gate is worthless");
  assert.ok(strayPop.length > 0, "the stray-pop twin escaped — the gate is worthless");
  // Confirm the twins are caught where expected: the substate byte / the SP.
  assert.ok(dropWrite[0].startsWith(`RAM@0x${GAME_SUBSTATE.toString(16)}`), `dropped-write should diverge at GAME_SUBSTATE, got ${dropWrite[0]}`);
  assert.ok(wrongSub[0].startsWith(`RAM@0x${GAME_SUBSTATE.toString(16)}`), `wrong-substate should diverge at GAME_SUBSTATE, got ${wrongSub[0]}`);
  assert.ok(strayPop.some((d) => d.startsWith("SP ")), `stray-pop should diverge on SP, got ${strayPop.join("; ")}`);

  // (d) no-unwind: RAM+pc+SP are identical (the harness models the unwind either way), so
  // ONLY the boolean signal catches it.
  const goodRet = runCandidate(entry, enterBoardAdvanceAndUnwind).ret;
  const badRet = runCandidate(entry, brokenNoUnwind).ret;
  assert.equal(goodRet, false, "the real routine must signal unwind (false)");
  assert.notEqual(badRet, false, "the no-unwind twin escaped the boolean check — the signal is not tested");

  console.log(
    `  TEETH: dropped-write (${dropWrite[0]}), wrong-substate (${wrongSub[0]}), ` +
      `stray-pop (${strayPop.find((d) => d.startsWith("SP "))}), no-unwind (ret ${badRet} != false) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1e85 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    const diffs = contractDiffs(entry, enterBoardAdvanceAndUnwind);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x1e85 dispatches in 8000 attract frames — attract never completes a board / rescues; crafted entries are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1e85 dispatch(es) — RAM+pc+SP identical to the oracle`);
  }
});
