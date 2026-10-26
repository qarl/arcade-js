// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b91 (ROM 0x2b91) — the ACCEPT arm of the tile-probe cascade.
 * It commits Mario's adjusted X (the probe live-in, register A) to BOTH the game position
 * MARIO_X (0x6203) and the +0 (X) field of Mario's sprite record MARIO_SPRITE_RECORD+SPRITE_X
 * (0x694c) — the write pair that keeps the on-screen sprite tracking MARIO_X live — then leaves
 * 1 in the result register for the still-translated caller and UNWINDS: the oracle discards its
 * own return address (`pop hl`) and returns one extra level up (`ret`), splicing past the probe's
 * caller. In direct-call form that non-local exit is a boolean; the idiomatic routine returns
 * false, the caller-skip signal.
 *
 * It is gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the LIVE result
 * register A (must be 1, the value the still-translated caller reads back) and the boolean unwind
 * signal. B/HL and the flags are dead ABI and are NOT compared (the oracle leaves the discarded
 * return in HL; the idiomatic form does not). The routine's whole effect is a pure function of the
 * one input byte A, so the gate SWEEPS all 256 adjusted-X values.
 *
 * The stack is CRAFTED (as in equivalence-2b74/2257): a booted attract machine, cloned, with a
 * controlled two-word return frame staged in STACK_SCRATCH so the oracle's `pop hl / ret` is
 * well-defined. Both cells are pre-poked to a per-input SENTINEL (x ^ 0xff, guaranteed != x) so a
 * skipped write is observable — a cell that keeps the sentinel proves the write never happened.
 *
 *   1. EQUAL (sweep) — all 256 adjusted-X inputs; on each, RAM (minus the stack scratch below the entry SP) + pc + SP + A
 *      identical to the oracle and the idiomatic routine returns false. Non-vacuity: the oracle
 *      really commits X to BOTH cells (over the sentinel) and leaves A=1, and unwinds two levels
 *      (SP += 4, pc -> the staged grandparent).
 *
 *   2. TEETH — deliberately-broken twins, each MUST be caught:
 *      (a) skip-MARIO_X   — writes only the sprite-record cell; caught at MARIO_X.
 *      (b) skip-sprite-X  — writes only MARIO_X; caught at the sprite-record cell.
 *      (c) wrong-A        — leaves A at 0 instead of 1; caught by the A live-out check.
 *      (d) no-unwind      — returns true instead of false; RAM+pc+SP+A are identical (the harness
 *                           models the unwind either way), so ONLY the boolean signal catches it.
 *
 *   3. REALISM — hook 0x2b91 over a long attract run; replay any real dispatch, else record that
 *      attract never reaches this arm (why the 256-input sweep is the gate).
 *
 * The oracle's two-level unwind (discard own return, then ret to the grandparent) is modeled on the
 * candidate as one discarded pop + one net return, so pc + SP line up; the discarded return and the
 * popped bytes both sit in STACK_SCRATCH (excluded by contract).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b91.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b91 as oracle } from "../../translated/loc_2b91.js";
import { loc_2b91 } from "../loc_2b91.js";
import { Machine } from "../../machine.js";
import { MARIO_X, MARIO_SPRITE_RECORD, SPRITE_X, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b91;
const MARIO_SPRITE_X = (MARIO_SPRITE_RECORD + SPRITE_X) & 0xffff; // 0x694c — the sprite record's +0 (X)
const GRAND_RET = 0x1c1f; // the grandparent return the two-level unwind lands on (compared both sides)
const OWN_RET = 0x2b2c;   // the "own" return the oracle discards (`pop hl` — the probe's continuation)
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa

const hx = (v) => "0x" + (v & 0xff).toString(16).padStart(2, "0");
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack region
 *  excluded by contract — the unwind's popped bytes live there). */
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

/** Run the ORACLE on a fresh clone. It writes X to both cells, sets A=1, then `pop hl` + `ret`, so
 *  SP += 4 and pc becomes the staged grandparent return. Returns {machine, ret}. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then model the oracle's two-level unwind with one discarded pop
 *  + one net return so pc + SP align (the idiomatic routine uses the JS call stack and returns a
 *  boolean; it never touches pc/SP itself). Returns {machine, ret}. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.pop16(); // discard the own return (models the oracle's `pop hl`)
  c.ret();   // net return to the grandparent (models the oracle's `ret`)
  return { c, ret };
}

/** Compare an already-run oracle machine vs an already-run candidate machine over the contract:
 *  RAM − the stack scratch below the entry SP, pc, SP, and the LIVE result register A. B/HL and the flags are dead ABI. */
function diffContract(o, c, liveFloor) {
  const diffs = [];
  const ram = firstRamDiff(o, c, liveFloor);
  if (ram) diffs.push(`RAM@0x${(ram.addr ?? 0).toString(16)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=0x${o.pc.toString(16)} cand=0x${c.pc.toString(16)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=0x${o.regs.sp.toString(16)} cand=0x${c.regs.sp.toString(16)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=0x${(o.regs.a & 0xff).toString(16)} cand=0x${(c.regs.a & 0xff).toString(16)}`);
  return diffs;
}

/** oracle-vs-candidate on independent fresh clones of the same entry. */
function contractDiffs(entry, fn) {
  return diffContract(runOracle(entry).c, runCandidate(entry, fn).c, entry.regs.sp);
}

// A real booted attract machine, built once and reused as the base for every crafted entry (cloned
// per case, never mutated).
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

/** A fresh crafted entry: real attract RAM, the adjusted X in A (the probe live-in), both target
 *  cells pre-poked to a SENTINEL (x ^ 0xff, != x) so a skipped write shows, and a controlled return
 *  stack — own return then grandparent return staged in STACK_SCRATCH. */
function craftEntry(x, grandRet = GRAND_RET) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running in isolation
  e.regs.a = x & 0xff;
  const sentinel = (x ^ 0xff) & 0xff; // guaranteed != x, so a missing write is observable
  e.mem.write8(MARIO_X, sentinel);
  e.mem.write8(MARIO_SPRITE_X, sentinel);
  e.regs.sp = SP_TOP;
  e.push16(grandRet); // -> 0x6bfa
  e.push16(OWN_RET);  // -> 0x6bf8 (the return the oracle discards)
  return e;
}

// -- teeth twins --------------------------------------------------------------

/** (a) skip-MARIO_X — writes only the sprite-record cell; MARIO_X keeps the sentinel. */
function brokenSkipMarioX(m) {
  const x = m.regs.a;
  m.mem.write8(MARIO_SPRITE_X, x); // BUG: never writes MARIO_X
  m.regs.a = 0x01;
  return false;
}

/** (b) skip-sprite-X — writes only MARIO_X; the sprite-record cell keeps the sentinel. */
function brokenSkipSpriteX(m) {
  const x = m.regs.a;
  m.mem.write8(MARIO_X, x); // BUG: never writes the sprite record's +0 (X)
  m.regs.a = 0x01;
  return false;
}

/** (c) wrong-A — commits both cells but leaves A at 0 instead of 1. */
function brokenWrongA(m) {
  const x = m.regs.a;
  m.mem.write8(MARIO_X, x);
  m.mem.write8(MARIO_SPRITE_X, x);
  m.regs.a = 0x00; // BUG: wrong live-out (the oracle leaves 1)
  return false;
}

/** (d) no-unwind — commits both cells and A=1 but signals "continue" (true) instead of "abort". */
function brokenNoUnwind(m) {
  const x = m.regs.a;
  m.mem.write8(MARIO_X, x);
  m.mem.write8(MARIO_SPRITE_X, x);
  m.regs.a = 0x01;
  return true; // BUG: not the caller-skip signal
}

// -- 1. EQUAL (sweep) ---------------------------------------------------------

test("EQUAL (sweep): loc_2b91 == oracle on RAM+pc+SP+A over all 256 adjusted-X inputs; returns the unwind signal", () => {
  let checked = 0;
  for (let x = 0; x < 256; x++) {
    const entry = craftEntry(x);
    const { c: o } = runOracle(entry);
    const { c, ret } = runCandidate(entry, loc_2b91);
    const diffs = diffContract(o, c, entry.regs.sp);
    assert.equal(diffs.length, 0, `X=${hx(x)}: ${diffs.join("; ")}`);
    assert.equal(ret, false, `X=${hx(x)}: idiomatic must return false (the unwind signal)`);
    checked++;
  }
  assert.equal(checked, 256, "must sweep the full adjusted-X space");

  // Non-vacuity: the oracle actually commits X to BOTH cells (over the sentinel) and leaves A=1,
  // and unwinds two levels (SP += 4, pc -> the staged grandparent). This is what makes EQUAL a real
  // assertion — MARIO_SPRITE_RECORD+SPRITE_X == MARIO_X live is exactly this write pair.
  const x = 0x5a;
  assert.notEqual((x ^ 0xff) & 0xff, x, "the sentinel must differ from X (the non-vacuity guard)");
  const { c: o, ret: oret } = runOracle(craftEntry(x, GRAND_RET));
  assert.equal(oret, false, "oracle must return false (the caller-skip signal)");
  assert.equal(o.mem.read8(MARIO_X), x, "oracle must write the adjusted X to MARIO_X");
  assert.equal(o.mem.read8(MARIO_SPRITE_X), x, "oracle must write the adjusted X to MARIO_SPRITE_RECORD+SPRITE_X");
  assert.equal(o.regs.a & 0xff, 1, "oracle must leave A=1 (the register live-out)");
  assert.equal(o.regs.sp, SP_TOP, "oracle must unwind SP by 4 (pop hl + ret)");
  assert.equal(o.pc, GRAND_RET, "oracle must return to the staged grandparent address (two levels up)");
  assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");

  console.log(`  EQUAL/sweep: 256 adjusted-X inputs identical on RAM+pc+SP+A; idiomatic returns false; oracle writes X to both cells, A=1, SP+4, pc->grandparent`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: skip-MARIO_X, skip-sprite-X, wrong-A and no-unwind twins are CAUGHT", () => {
  const x = 0x5a; // any value; the sentinel (0xa5) differs, so a skipped write is observable
  const entry = craftEntry(x);

  const skipX = contractDiffs(entry, brokenSkipMarioX);
  const skipS = contractDiffs(entry, brokenSkipSpriteX);
  const wrongA = contractDiffs(entry, brokenWrongA);
  assert.ok(skipX.length > 0, "the skip-MARIO_X twin escaped — the MARIO_X write is not proven");
  assert.ok(skipS.length > 0, "the skip-sprite-X twin escaped — the sprite-record write is not proven");
  assert.ok(wrongA.length > 0, "the wrong-A twin escaped — the A live-out check is worthless");

  // Confirm each twin is caught where expected: the specific cell, the A register.
  assert.ok(
    skipX.some((d) => d.startsWith(`RAM@0x${MARIO_X.toString(16)}`)),
    `skip-MARIO_X should diverge at MARIO_X (0x${MARIO_X.toString(16)}), got ${skipX.join("; ")}`,
  );
  assert.ok(
    skipS.some((d) => d.startsWith(`RAM@0x${MARIO_SPRITE_X.toString(16)}`)),
    `skip-sprite-X should diverge at the sprite record (0x${MARIO_SPRITE_X.toString(16)}), got ${skipS.join("; ")}`,
  );
  assert.ok(wrongA.some((d) => d.startsWith("A ")), `wrong-A should diverge on A, got ${wrongA.join("; ")}`);

  // (d) no-unwind: RAM+pc+SP+A are identical (the harness models the unwind either way), so ONLY the
  // boolean signal catches it.
  const goodRet = runCandidate(entry, loc_2b91).ret;
  const badRet = runCandidate(entry, brokenNoUnwind).ret;
  assert.equal(goodRet, false, "the real routine must signal the unwind (false)");
  assert.notEqual(badRet, false, "the no-unwind twin escaped the boolean check — the signal is not tested");

  console.log(
    `  TEETH: skip-MARIO_X (${skipX.find((d) => d.startsWith("RAM@"))}), skip-sprite-X (${skipS.find((d) => d.startsWith("RAM@"))}), ` +
      `wrong-A (${wrongA.find((d) => d.startsWith("A "))}), no-unwind (ret ${badRet} != false) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x2b91 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, loc_2b91);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x2b91 dispatches in 8000 attract frames — the tile-probe accept arm is not reached in attract; the 256-input sweep is the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x2b91 dispatch(es) — RAM+pc+SP+A identical to the oracle`);
  }
});
