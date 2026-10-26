// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for loc_2b7a (ROM 0x2b7a) — the head of the tile-probe's horizontal
 * X-snap and the sibling of loc_2b8b. It reads the high byte of Mario's airborne X-velocity
 * (MARIO_AIR_VX_HI, 0x6210) and Mario's current X (MARIO_X, 0x6203), then splits:
 *   - velocity high byte zero    -> hand Mario's current X to loc_2b8b, which snaps it to
 *                                   its 8-pixel column — net (X & ~7) + 3 — and commits it
 *                                   through loc_2b91.
 *   - velocity high byte nonzero -> snap X here, `(X | 7) - 4` (algebraically the SAME
 *                                   (X & ~7) + 3), and hand the snapped X to loc_2b91.
 * loc_2b91 stores the snapped X to MARIO_X (0x6203) and the sprite-record X (0x694c), leaves
 * 1 in the result register, and performs the two-level caller-skip unwind (`pop hl` + `ret`).
 *
 * KEY PROPERTY — the two arms are MEMORY-EQUIVALENT: both compute the same snapped X and
 * commit it identically, so the routine's whole memory effect is a pure function of MARIO_X,
 * INDEPENDENT of the velocity high byte beyond its zero test. The arm selection itself is
 * therefore invisible to the memory-equivalence contract (an inverted branch would produce
 * byte-identical RAM), so it is NOT a teeth surface — it is a faithful-dispatch property,
 * verified by inspection (each callee, gated by its own equivalence test, produces the same
 * effect). What the gate here proves is the snap arithmetic loc_2b7a does itself (the nonzero
 * arm), the marshalling into each callee, the committed X, the A live-out, and the unwind.
 *
 * In the oracle, loc_2b7a tail-dispatches (`m.call`) through the registry to the STILL-TRANSLATED loc_2b8b/loc_2b91,
 * so the oracle really performs the two-level unwind (SP += 4, pc -> the grandparent return). The idiomatic routine
 * calls the idiomatic callees directly; they model that unwind as a boolean and touch no stack, so the harness's
 * runCandidate adds one discarded `pop16` + one net `ret` after it, lining pc + SP up with the oracle. Both the
 * discarded return and the popped bytes sit in STACK_SCRATCH, excluded by the contract.
 *
 * Gated on MEMORY-equivalence — RAM (minus the stack scratch below the entry SP) + pc + SP — plus the LIVE result
 * register A (the grandparent reads it back with `dec a`) and the boolean unwind signal. HL and the flags are dead
 * ABI and are NOT compared. loc_2b7a reads no register live-in (it loads its inputs from memory), so the entry
 * accumulator is poisoned to make a dropped marshalling observable.
 *
 *   1. EQUAL (factored proof) — the memory effect is a pure function of MARIO_X, so three
 *      sweeps cover the space: the ZERO arm (velocity high byte 0) over all 256 X, the
 *      NONZERO arm (velocity high byte 1) over all 256 X, and the ARM SELECTOR over all 256
 *      velocity-high-byte values at a fixed X. On each, RAM + pc + SP + A identical to the
 *      oracle and the idiomatic routine returns false; non-vacuity asserts the oracle really
 *      writes the snapped X to BOTH cells (over a sentinel), leaves A=1, and unwinds two
 *      levels (SP += 4, pc -> the staged grandparent).
 *
 *   2. TEETH — five deliberately-broken twins, each MUST be caught:
 *      (a) wrong-adjust        — nonzero arm snaps with `- 3`; caught by the MARIO_X RAM diff.
 *      (b) no-snap (nonzero)   — nonzero arm commits the raw X (drops loc_2b7a's own snap);
 *                                caught by the MARIO_X RAM diff — proves the snap is real.
 *      (c) zero-arm no-marshal — zero arm forgets to load Mario's X into the accumulator, so
 *                                loc_2b8b snaps the poisoned entry value; caught at MARIO_X.
 *      (d) wrong-A             — leaves 2 in the result register instead of 1; caught by A.
 *      (e) no-unwind           — returns true instead of false; RAM+pc+SP+A identical (the harness models
 *                                the unwind either way), so ONLY the boolean signal catches it.
 *
 *   3. REALISM — hook 0x2b7a over a long attract run; replay any real dispatch, else record
 *      that attract never reaches it (why the crafted factored sweep is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-2b7a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b7a as oracle } from "../../translated/loc_2b7a.js";
import { loc_2b7a } from "../loc_2b7a.js";
import { loc_2b8b } from "../loc_2b8b.js";
import { loc_2b91 } from "../loc_2b91.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, MARIO_AIR_VX_HI, MARIO_X, MARIO_SPRITE_RECORD, SPRITE_X } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x2b7a;
const SPRITE_X_ADDR = (MARIO_SPRITE_RECORD + SPRITE_X) & 0xffff; // 0x694c — the sprite record's +0 (X)
const GRAND_RET = 0x1c08; // the grandparent return the two-level unwind lands on (staged; compared both sides)
const OWN_RET = 0x2b74;   // the caller-continuation return the unwind discards (`pop hl`; staged)
const SP_TOP = 0x6bfc;    // inside STACK_SCRATCH; the two staged returns sit at 0x6bf8/0x6bfa
const POISON_A = 0xaa;    // entry accumulator; loc_2b7a reads no register live-in, so this must be overwritten

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (addr) => addr != null && addr >= STACK_SCRATCH.lo && addr < STACK_SCRATCH.hi;

// The snap both arms compute, closed for the non-vacuity assertions: X -> (X & ~7) + 3.
const snap = (x) => (((x - 8) | 0x07) + 4) & 0xff;

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

/** Run the ORACLE on a fresh clone. Its `m.call` reaches the translated loc_2b8b/loc_2b91, which write MARIO_X +
 *  the sprite X, set A=1, then `pop hl` + `ret` (SP += 4, pc -> the staged grandparent). Returns {machine, ret}. */
function runOracle(entry) {
  const c = entry.clone();
  const ret = oracle(c);
  return { c, ret };
}

/** Run a candidate on a fresh clone, then model the dissolved two-level unwind with one discarded pop + one net
 *  return so pc + SP align (the idiomatic routine uses the JS call stack and returns a boolean; it never touches
 *  pc/SP itself). Returns {machine, ret}. */
function runCandidate(entry, fn) {
  const c = entry.clone();
  const ret = fn(c);
  c.pop16(); // discard the caller-continuation return (models loc_2b91's `pop hl`)
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

/** A fresh crafted entry: real attract RAM; the velocity high byte and Mario's X poked into memory (loc_2b7a's real
 *  inputs); the sprite-record X pre-poked to a per-input SENTINEL (!= snap) so a skipped write shows; a poisoned
 *  entry accumulator (the routine reads no register live-in, so it must overwrite this); and a controlled return
 *  stack — the discarded caller return then the grandparent return staged in STACK_SCRATCH. */
function craftEntry(vxHi, x, grandRet = GRAND_RET) {
  const e = base().clone();
  e.nextNmi = Infinity;      // neutralise the frame machinery so the oracle's `m.step`
  e.nextBoundary = Infinity; // cannot fire an NMI or push a frame while running in isolation
  e.mem.write8(MARIO_AIR_VX_HI, vxHi & 0xff);
  e.mem.write8(MARIO_X, x & 0xff);
  e.mem.write8(SPRITE_X_ADDR, (snap(x) ^ 0xff) & 0xff); // sentinel != the value that will be written
  e.regs.a = POISON_A;
  e.regs.sp = SP_TOP;
  e.push16(grandRet); // -> 0x6bfa
  e.push16(OWN_RET);  // -> 0x6bf8 (the return the unwind discards)
  return e;
}

/** Sweep `candidate` across both arms — the zero arm and a representative nonzero arm — over all 256 X; return the
 *  first mismatch (or null). */
function fullSweep(candidate) {
  for (const vxHi of [0x00, 0x01]) {
    for (let x = 0; x < 256; x++) {
      const diffs = contractDiffs(craftEntry(vxHi, x), candidate);
      if (diffs.length) return { mismatch: { vxHi, x, diffs }, count: (vxHi === 0 ? 0 : 256) + x + 1 };
    }
  }
  return { mismatch: null, count: 512 };
}

// -- teeth twins --------------------------------------------------------------

/** (a) wrong-adjust — the nonzero arm snaps to the wrong column (`- 3`, not `- 4`). */
function brokenWrongAdjust(m) {
  const { regs, mem } = m;
  const marioX = mem.read8(MARIO_X);
  if (mem.read8(MARIO_AIR_VX_HI) === 0) { regs.a = marioX; return loc_2b8b(m); }
  regs.a = (marioX | 0x07) - 3; // BUG: - 3, not - 4
  return loc_2b91(m);
}

/** (b) no-snap (nonzero arm) — commits the raw X without snapping (drops loc_2b7a's own snap). */
function brokenNoSnap(m) {
  const { regs, mem } = m;
  const marioX = mem.read8(MARIO_X);
  if (mem.read8(MARIO_AIR_VX_HI) === 0) { regs.a = marioX; return loc_2b8b(m); }
  regs.a = marioX; // BUG: no snap — the raw candidate X is committed
  return loc_2b91(m);
}

/** (c) zero-arm no-marshal — the zero arm never loads Mario's X into the accumulator, so
 *  loc_2b8b snaps the poisoned entry value instead. */
function brokenZeroArmNoMarshal(m) {
  const { regs, mem } = m;
  const marioX = mem.read8(MARIO_X);
  if (mem.read8(MARIO_AIR_VX_HI) === 0) { return loc_2b8b(m); } // BUG: forgot regs.a = marioX
  regs.a = (marioX | 0x07) - 4;
  return loc_2b91(m);
}

/** (d) wrong-A — snaps and commits correctly but leaves 2 in the result register. */
function brokenWrongA(m) {
  const r = loc_2b7a(m); // correct memory + unwind
  m.regs.a = 2;          // BUG: should be the 1 loc_2b91 left
  return r;
}

/** (e) no-unwind — snaps and commits correctly but signals "continue" (true) not "abort". */
function brokenNoUnwind(m) {
  loc_2b7a(m); // correct memory + A
  return true; // BUG: should be false (the caller-skip signal)
}

// -- 1. EQUAL (factored proof) ------------------------------------------------

test("EQUAL: loc_2b7a == oracle on RAM+pc+SP+A over both arms (all 256 X) and all 256 selector values", () => {
  let compared = 0;

  // The two arms, each over the full 256-value X space.
  for (const vxHi of [0x00, 0x01]) {
    for (let x = 0; x < 256; x++) {
      const entry = craftEntry(vxHi, x);
      const diffs = contractDiffs(entry, loc_2b7a);
      assert.equal(diffs.length, 0, `vxHi=${hx(vxHi)} X=${hx(x)}: ${diffs.join("; ")}`);
      assert.equal(runCandidate(entry, loc_2b7a).ret, false, `vxHi=${hx(vxHi)} X=${hx(x)}: idiomatic must return false`);
      compared++;
    }
  }

  // The arm SELECTOR over all 256 velocity-high-byte values at a fixed X.
  const selX = 0x84;
  for (let vxHi = 0; vxHi < 256; vxHi++) {
    const diffs = contractDiffs(craftEntry(vxHi, selX), loc_2b7a);
    assert.equal(diffs.length, 0, `selector vxHi=${hx(vxHi)} X=${hx(selX)}: ${diffs.join("; ")}`);
    compared++;
  }
  assert.equal(compared, 256 + 256 + 256, "must have compared both arms over all X plus the full selector sweep");

  // Non-vacuity, per arm.
  const x = 0x84; // snap(0x84) = 0x83 != 0x84, so the MARIO_X write is observable
  assert.notEqual(snap(x), x, "the non-vacuity X must have snap(X) != X so the MARIO_X write shows");
  for (const vxHi of [0x00, 0x01]) {
    const { c: o, ret: oret } = runOracle(craftEntry(vxHi, x));
    assert.equal(oret, false, `vxHi=${hx(vxHi)}: oracle must return false (the caller-skip signal)`);
    assert.equal(o.mem.read8(MARIO_X), snap(x), `vxHi=${hx(vxHi)}: oracle must write the snapped X to MARIO_X`);
    assert.equal(o.mem.read8(SPRITE_X_ADDR), snap(x), `vxHi=${hx(vxHi)}: oracle must write the snapped X to the sprite record`);
    assert.equal(o.regs.a & 0xff, 1, `vxHi=${hx(vxHi)}: oracle must leave 1 in the result register`);
    assert.equal(o.regs.sp, SP_TOP, `vxHi=${hx(vxHi)}: oracle must unwind SP by 4 (pop hl + ret)`);
    assert.equal(o.pc, GRAND_RET, `vxHi=${hx(vxHi)}: oracle must return to the staged grandparent (two levels up)`);
  }
  assert.ok(inStack(SP_TOP - 2) && inStack(SP_TOP - 4), "the staged returns must sit in STACK_SCRATCH");

  console.log(`  EQUAL: ${compared} entries (zero arm ×256, nonzero arm ×256, selector ×256) — RAM+pc+SP+A identical to the oracle; idiomatic returns false; both arms snap+commit X to both cells, A=1, SP+4, pc->grandparent`);
});

// -- 2. TEETH -----------------------------------------------------------------

test("TEETH: wrong-adjust, no-snap, zero-arm-no-marshal, wrong-A and no-unwind twins are CAUGHT", () => {
  const wrongAdjust = fullSweep(brokenWrongAdjust);
  const noSnap = fullSweep(brokenNoSnap);
  const zeroMarshal = fullSweep(brokenZeroArmNoMarshal);
  const wrongA = fullSweep(brokenWrongA);
  assert.notEqual(wrongAdjust.mismatch, null, "the wrong-adjust twin escaped — the MARIO_X RAM diff is worthless");
  assert.notEqual(noSnap.mismatch, null, "the no-snap twin escaped — loc_2b7a's own snap is not tested");
  assert.notEqual(zeroMarshal.mismatch, null, "the zero-arm-no-marshal twin escaped — the zero-arm marshalling is not tested");
  assert.notEqual(wrongA.mismatch, null, "the wrong-A twin escaped — the A live-out check is worthless");

  // Confirm each memory/register twin is caught where expected.
  assert.ok(wrongAdjust.mismatch.diffs.some((d) => d.startsWith(`RAM@${hx(MARIO_X)}`)),
    `wrong-adjust should diverge on MARIO_X, got ${wrongAdjust.mismatch.diffs.join("; ")}`);
  assert.ok(noSnap.mismatch.diffs.some((d) => d.startsWith(`RAM@${hx(MARIO_X)}`)),
    `no-snap should diverge on MARIO_X, got ${noSnap.mismatch.diffs.join("; ")}`);
  assert.ok(zeroMarshal.mismatch.diffs.some((d) => d.startsWith(`RAM@${hx(MARIO_X)}`)),
    `zero-arm-no-marshal should diverge on MARIO_X, got ${zeroMarshal.mismatch.diffs.join("; ")}`);
  assert.ok(wrongA.mismatch.diffs.some((d) => d.startsWith("A ")),
    `wrong-A should diverge on A, got ${wrongA.mismatch.diffs.join("; ")}`);

  // (e) no-unwind: RAM+pc+SP+A are identical (the harness models the unwind either way), so ONLY the boolean signal catches it.
  const entry = craftEntry(0x01, 0x84);
  const goodRet = runCandidate(entry, loc_2b7a).ret;
  const badRet = runCandidate(entry, brokenNoUnwind).ret;
  assert.equal(goodRet, false, "the real routine must signal unwind (false)");
  assert.notEqual(badRet, false, "the no-unwind twin escaped the boolean check — the signal is not tested");

  console.log(
    `  TEETH: wrong-adjust (${wrongAdjust.mismatch.diffs.find((d) => d.startsWith("RAM@"))} @vxHi=${hx(wrongAdjust.mismatch.vxHi)} X=${hx(wrongAdjust.mismatch.x)}), ` +
      `no-snap (${noSnap.mismatch.diffs.find((d) => d.startsWith("RAM@"))} @X=${hx(noSnap.mismatch.x)}), ` +
      `zero-arm-no-marshal (${zeroMarshal.mismatch.diffs.find((d) => d.startsWith("RAM@"))} @X=${hx(zeroMarshal.mismatch.x)}), ` +
      `wrong-A (${wrongA.mismatch.diffs.find((d) => d.startsWith("A "))} @X=${hx(wrongA.mismatch.x)}), ` +
      `no-unwind (ret ${badRet} != false) all caught`,
  );
});

// -- 3. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x2b7a dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snapMap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snapMap });
  host.runFrames(8000);

  for (const entry of caps) {
    entry.nextNmi = Infinity;
    entry.nextBoundary = Infinity;
    const diffs = contractDiffs(entry, loc_2b7a);
    assert.equal(diffs.length, 0, diffs.join("; "));
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x2b7a dispatches in 8000 attract frames — this X-snap head is not reached in attract; the crafted factored sweep is the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x2b7a dispatch(es) — RAM+pc+SP+A identical to the oracle`);
  }
});
