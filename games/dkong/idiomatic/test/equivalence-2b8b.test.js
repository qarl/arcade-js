// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b8b (ROM 0x2b8b) — the airborne-VX==0 arm of the tile-probe's
 * horizontal snap. It snaps the candidate X (Mario's current X, handed in via the accumulator)
 * to its 8-pixel column — net (X & ~7) + 3, done as `((X - 8) | 7) + 4` — then falls into
 * loc_2b91, which stores that X to MARIO_X (0x6203) and the sprite-record X (0x694c), leaves 1
 * in the result register, and performs the two-level caller-skip unwind (`pop hl` + `ret`).
 *
 * In the oracle, loc_2b8b's `m.call(0x2b91)` dispatches through the registry to the STILL-
 * TRANSLATED loc_2b91, so the oracle really does the two-level unwind (SP += 4, pc -> the
 * grandparent return). The idiomatic routine calls the idiomatic loc_2b91 directly, which
 * models that unwind as a boolean and touches no stack; so the harness's runCandidate adds one
 * discarded `pop16` + one net `ret` after it, lining pc + SP up with the oracle. Both the
 * discarded return and the popped bytes sit in STACK_SCRATCH, excluded by the contract.
 *
 * Gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the LIVE result
 * register A (the grandparent past loc_2b1c reads it with `dec a`) and the boolean unwind
 * signal. HL and the flags are dead ABI and are NOT compared.
 *
 * The routine's ONLY input is the candidate X in the accumulator (its memory effect is a pure
 * function of that byte), so the gate is EXHAUSTIVE over all 256 values — a proof, not a sample.
 *
 *   1. EQUAL (exhaustive) — every candidate X 0..255 on a real attract base with a staged
 *      return stack; RAM + pc + SP + A identical to the oracle, the idiomatic routine returns
 *      false, and the oracle's own writes are asserted (MARIO_X == the sprite X == the expected
 *      snap, A == 1, SP += 4, pc -> the staged grandparent) so EQUAL is not vacuous.
 *
 *   2. TEETH — four deliberately-broken twins, each MUST be caught:
 *      (a) wrong-adjust  — snaps with `+ 5` instead of `+ 4`; caught by the MARIO_X RAM diff.
 *      (b) no-marshal    — skips the snap and commits the raw candidate X (drops the register
 *                          marshalling); caught by the MARIO_X RAM diff — proves the snap is real.
 *      (c) wrong-A       — leaves 2 in the result register instead of 1; caught by the A live-out.
 *      (d) no-unwind     — returns true instead of false; caught only by the boolean signal.
 *
 *   3. REALISM — hook 0x2b8b over a long attract run; replay any real dispatch, else record that
 *      attract never reaches it (why the crafted exhaustive sweep is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b8b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b8b as oracle } from "../../translated/loc_2b8b.js";
import { loc_2b8b } from "../loc_2b8b.js";
import { loc_2b91 } from "../loc_2b91.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_X, MARIO_SPRITE_RECORD, SPRITE_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b8b;
const SPRITE_X_ADDR = (MARIO_SPRITE_RECORD + SPRITE_X) & 0xffff; // 0x694c
const GRAND_RET = 0x1c08; // the grandparent return the unwind lands on (compared both sides)
const OWN_RET = 0x2b7d;   // the probe-continuation return the unwind discards (`pop hl`)
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// The oracle's arithmetic, closed for the non-vacuity assertions: snap X to (X & ~7) + 3.
const snap = (x) => (((x - 8) | 0x07) + 4) & 0xff;

// -- the memory-equivalence contract ------------------------------------------

/** First RAM byte that differs between two machines, skipping the stack scratch below the entry SP (the dead stack
 *  region excluded by contract — the dissolved unwind's popped bytes live there). */
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

/** Run the ORACLE on a fresh clone. Its `m.call(0x2b91)` reaches the translated loc_2b91,
 *  which writes MARIO_X + the sprite X, sets A=1, then `pop hl` + `ret` (SP += 4, pc -> the
 *  staged grandparent). Returns {machine, ret}. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then model the dissolved two-level unwind with one
 *  discarded pop + one net return so pc + SP align (the idiomatic routine uses the JS call
 *  stack and returns a boolean; it never touches pc/SP itself). Returns {machine, ret}. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.pop16(); // discard the probe-continuation return (models loc_2b91's `pop hl`)
  c.ret();   // net return to the grandparent (models loc_2b91's `ret`)
  return { c, ret };
}

/** Compare candidate vs oracle over the contract: RAM − the stack scratch below the entry SP, pc, SP, and the LIVE
 *  result register A. HL and the flags are dead ABI and are not compared. */
function contractDiffs(entry, fn) {
  const { c: o } = runOracle(entry);
  const { c } = runCandidate(entry, fn);
  const diffs = [];
  const ram = firstRamDiff(o, c, entry.regs.sp);
  if (ram) diffs.push(`RAM@${hx(ram.addr)} oracle=0x${(ram.a & 0xff).toString(16)} cand=0x${(ram.b & 0xff).toString(16)}`);
  if (o.pc !== c.pc) diffs.push(`pc oracle=${hx(o.pc)} cand=${hx(c.pc)}`);
  if (o.regs.sp !== c.regs.sp) diffs.push(`SP oracle=${hx(o.regs.sp)} cand=${hx(c.regs.sp)}`);
  if (o.regs.a !== c.regs.a) diffs.push(`A oracle=0x${(o.regs.a & 0xff).toString(16)} cand=0x${(c.regs.a & 0xff).toString(16)}`);
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

/** A fresh crafted entry: real attract RAM, the candidate X in the accumulator, and a
 *  controlled return stack — the discarded probe return then the grandparent return staged in
 *  STACK_SCRATCH. */
function craftEntry(x, grandRet = GRAND_RET) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running in isolation
  e.regs.a = x;
  e.regs.sp = SP_TOP;
  e.push16(grandRet); // -> 0x6bfa
  e.push16(OWN_RET);  // -> 0x6bf8 (the return the unwind discards)
  return e;
}

/** Sweep all 256 candidate-X values against `candidate`; return the first mismatch (or null). */
function fullSweep(candidate) {
  for (let x = 0; x < 256; x++) {
    const diffs = contractDiffs(craftEntry(x), candidate);
    if (diffs.length) return { mismatch: { x, diffs }, count: x + 1 };
  }
  return { mismatch: null, count: 256 };
}

// -- teeth twins --------------------------------------------------------------

/** (a) wrong-adjust — snaps with `+ 5`, so it commits a different X. */
function brokenWrongAdjust(m) {
  const { regs } = m;
  regs.a = ((regs.a - 8) | 0x07) + 5; // BUG: + 5, not + 4
  return loc_2b91(m);
}

/** (b) no-marshal — commits the raw candidate X without snapping (drops the marshalling). */
function brokenNoMarshal(m) {
  return loc_2b91(m); // BUG: regs.a still holds the un-snapped candidate X
}

/** (c) wrong-A — snaps and commits correctly but leaves 2 in the result register. */
function brokenWrongA(m) {
  const { regs } = m;
  regs.a = ((regs.a - 8) | 0x07) + 4;
  loc_2b91(m);
  regs.a = 2; // BUG: should be the 1 loc_2b91 left
  return false;
}

/** (d) no-unwind — snaps and commits correctly but signals "continue" (true) not "abort". */
function brokenNoUnwind(m) {
  const { regs } = m;
  regs.a = ((regs.a - 8) | 0x07) + 4;
  loc_2b91(m);
  return true; // BUG: should be false (the caller-skip signal)
}

// -- 1. EQUAL (exhaustive) ----------------------------------------------------

test("EQUAL (exhaustive): loc_2b8b == oracle on RAM+pc+SP+A over all 256 candidate-X values", () => {
  let compared = 0;
  for (let x = 0; x < 256; x++) {
    const entry = craftEntry(x);

    const diffs = contractDiffs(entry, loc_2b8b);
    assert.equal(diffs.length, 0, `X=${hx(x)}: ${diffs.join("; ")}`);

    // The idiomatic routine must signal the caller-skip unwind with false.
    const { ret } = runCandidate(entry, loc_2b8b);
    assert.equal(ret, false, `X=${hx(x)}: idiomatic must return false (the unwind signal)`);

    // Oracle sanity — so EQUAL is not vacuous and the memory/register/stack contract bites.
    const { c: o, ret: oret } = runOracle(entry);
    assert.equal(oret, false, "oracle must return false (the caller-skip signal)");
    assert.equal(o.mem.read8(MARIO_X), snap(x), `X=${hx(x)}: oracle must write the snapped X to MARIO_X`);
    assert.equal(o.mem.read8(SPRITE_X_ADDR), snap(x), `X=${hx(x)}: oracle must write the snapped X to the sprite record`);
    assert.equal(o.regs.a & 0xff, 1, "oracle must leave 1 in the result register");
    assert.equal(o.regs.sp, (SP_TOP - 4 + 4) & 0xffff, "oracle must unwind SP by 4 (pop hl + ret)");
    assert.equal(o.pc, GRAND_RET, "oracle must return to the staged grandparent (two levels up)");
    compared++;
  }
  assert.equal(compared, 256, "must have compared the full 256-value candidate-X space");
  console.log(`  EQUAL/exhaustive: ${compared} candidate-X values — RAM+pc+SP+A identical to the oracle; idiomatic returns false`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: wrong-adjust, no-marshal, wrong-A and no-unwind twins are CAUGHT", () => {
  const adjust = fullSweep(brokenWrongAdjust);
  const noMarshal = fullSweep(brokenNoMarshal);
  const wrongA = fullSweep(brokenWrongA);
  assert.notEqual(adjust.mismatch, null, "the wrong-adjust twin escaped — the MARIO_X RAM diff is worthless");
  assert.notEqual(noMarshal.mismatch, null, "the no-marshal twin escaped — the snap/marshal is not tested");
  assert.notEqual(wrongA.mismatch, null, "the wrong-A twin escaped — the A live-out check is worthless");

  // Confirm each is caught where expected: the committed X (MARIO_X) and the result register.
  assert.ok(adjust.mismatch.diffs.some((d) => d.startsWith(`RAM@${hx(MARIO_X)}`)),
    `wrong-adjust should diverge on MARIO_X, got ${adjust.mismatch.diffs.join("; ")}`);
  assert.ok(noMarshal.mismatch.diffs.some((d) => d.startsWith(`RAM@${hx(MARIO_X)}`)),
    `no-marshal should diverge on MARIO_X, got ${noMarshal.mismatch.diffs.join("; ")}`);
  assert.ok(wrongA.mismatch.diffs.some((d) => d.startsWith("A ")),
    `wrong-A should diverge on A, got ${wrongA.mismatch.diffs.join("; ")}`);

  // (d) no-unwind: RAM+pc+SP+A are identical (the harness models the unwind either way), so
  // ONLY the boolean signal catches it.
  const entry = craftEntry(0x84);
  const goodRet = runCandidate(entry, loc_2b8b).ret;
  const badRet = runCandidate(entry, brokenNoUnwind).ret;
  assert.equal(goodRet, false, "the real routine must signal unwind (false)");
  assert.notEqual(badRet, false, "the no-unwind twin escaped the boolean check — the signal is not tested");

  console.log(
    `  TEETH: wrong-adjust (${adjust.mismatch.diffs.find((d) => d.startsWith("RAM@"))} @X=${hx(adjust.mismatch.x)}), ` +
      `no-marshal (${noMarshal.mismatch.diffs.find((d) => d.startsWith("RAM@"))} @X=${hx(noMarshal.mismatch.x)}), ` +
      `wrong-A (${wrongA.mismatch.diffs.find((d) => d.startsWith("A "))} @X=${hx(wrongA.mismatch.x)}), ` +
      `no-unwind (ret ${badRet} != false) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x2b8b dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snapMap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snapMap });
  host.runFrames(8000);

  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, loc_2b8b);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x2b8b dispatches in 8000 attract frames — this X-snap arm is not reached in attract; the crafted exhaustive sweep is the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x2b8b dispatch(es) — RAM+pc+SP+A identical to the oracle`);
  }
});
