// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for setupIntroCutsceneStep (ROM 0x0A8A) — step 0 of the opening
 * Kong-climb cutscene: draw the cutscene playfield and seed its animation state.
 *
 * setupIntroCutsceneStep WRITES memory and is NOT a leaf — it draws the playfield via
 * the idiomatic callee loc_0da7 (which walks the 0x380D segment table, itself calling
 * the frozen oracle sub_2ff0) — so it is gated by capture / clone / replay (docs/decompiler-pipeline)
 * with a FRESH clone per case. It is straight-line with NO work-RAM inputs: every value
 * is an immediate or the deterministic 0x380D ROM record walk, so the ONLY output byte
 * that depends on prior RAM is `inc (INTRO_STEP)` at the tail. That makes INTRO_STEP the
 * single input worth sweeping, and it is swept EXHAUSTIVELY.
 *
 * A 6000-frame attract run dispatches 0x0a8a ZERO times (the intro cutscene is a
 * credited game's per-board head, GAME_SUBSTATE 7 / INTRO_STEP 0 — not reached in
 * attract), so — exactly as docs/decompiler-pipeline prescribes for arms attract never reaches — the gate
 * is CRAFTED: a real booted attract machine, cloned, oracle-vs-idiomatic on independent
 * fresh clones. The comparison is game-visible RAM MINUS the stack scratch below the entry SP:
 * loc_0da7's leaf sub_2ff0 does an unmatched `ret` on the direct-call path that drifts SP
 * upward (a stack seam, not logic; SP/pc are the dropped stack model, not compared), so
 * both sides are pinned to a crafted SP with headroom inside STACK_SCRATCH.
 *
 *   1. STRUCTURE — a crafted natural-step-0 entry: game-visible RAM identical to the
 *      oracle, and the oracle's salient outputs asserted (so an EQUAL result is not
 *      vacuous — the body really wrote the palette/tiles/pointers/timer/step and drew
 *      the playfield). The crafted SP's margin is asserted to cover BOTH the oracle's
 *      deepest push and the idiomatic side's highest unmatched pop, so excluding
 *      STACK_SCRATCH cannot mask a game-visible divergence.
 *
 *   2. INTRO_STEP (exhaustive) — sweep INTRO_STEP 0..255. Pins the `inc (0x6385)` result
 *      = (step+1)&0xFF over every step byte incl. the 0xFF->0x00 wrap, with the full
 *      work footprint identical to the oracle each time.
 *
 *   3. TEETH — two twins the RAM diff MUST catch: (a) SWAPPED-SEED writes the two walk
 *      pointers 0x63C2/0x63C4 with each other's seed, caught naming 0x63C2; (b)
 *      DROPPED-ADVANCE omits the `inc (INTRO_STEP)`, caught by the sweep naming 0x6385.
 *
 *   4. REALISM — hook 0x0a8a over a long attract run; replay any real dispatch if one
 *      occurs, else record that attract never reaches this cutscene (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0a8a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a8a as oracle } from "../../translated/loc_0a8a.js";
import { setupIntroCutsceneStep as idiomatic } from "../setupIntroCutsceneStep.js";
import { drawBoardLayout as loc_0da7 } from "../drawBoardLayout.js"; // idiomatic callee, for the teeth twins
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SUBSTATE_TIMER, INTRO_STEP } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0a8a;
const WALK_PTR_0B06 = 0x63c2;
const WALK_PTR_0B68 = 0x63c4;
const CUTSCENE_BOOKKEEPING = 0x62af;
const KIND = 0x63b3; // loc_0da7's terminator scratch — 0xAA once the walk ends
const ADDR1 = 0x63ab; // loc_0da7's first-point tile address — nonzero after a real walk

// Inside STACK_SCRATCH with headroom BOTH ways: the oracle's push16 descends to SP-6
// (matched pops climb back), and the idiomatic side's unmatched sub_2ff0 `ret` climbs to
// SP+4. 0x6bf8 clears the region floor (0x6be0) and ceiling (0x6c00) on both.
const SP_CRAFT = 0x6bf8;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Also
 * returns the stack-diff count, so a test can assert the exclusion is load-bearing.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0, bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

const read16 = (m, addr) => m.mem.read8(addr) | (m.mem.read8(addr + 1) << 8);

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). Genuine work RAM; only INTRO_STEP and the
// (vestigial) SP move.
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

/** Two independent fresh clones of the base at the same INTRO_STEP + crafted SP (docs/decompiler-pipeline
 *  fresh clone per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(step) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(INTRO_STEP, step);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: crafted step-0 entry — game-visible RAM identical; oracle really did the work", () => {
  const [a, b] = craftPair(0);
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle actually did the work — confirm the salient outputs so an EQUAL result is
  // not vacuous (the body wrote the state, and loc_0da7 drew the playfield).
  assert.equal(a.mem.read8(SUBSTATE_TIMER), 0x40, "oracle must arm the 64-frame phase timer (0x6009=0x40)");
  assert.equal(a.mem.read8(INTRO_STEP), 1, "oracle must advance INTRO_STEP 0 -> 1");
  assert.equal(read16(a, WALK_PTR_0B06), 0x38b4, "oracle must seed loc_0b06's walk pointer 0x63C2=0x38B4");
  assert.equal(read16(a, WALK_PTR_0B68), 0x38cb, "oracle must seed loc_0b68's walk pointer 0x63C4=0x38CB");
  assert.equal(a.mem.read8(CUTSCENE_BOOKKEEPING), 0x00, "oracle must clear 0x62AF");
  assert.equal(a.mem.read8(0x76a3), 0x10, "oracle must stamp cutscene tile 0x76A3=0x10");
  assert.equal(a.mem.read8(0x7663), 0x10, "oracle must stamp cutscene tile 0x7663=0x10");
  assert.equal(a.mem.read8(0x75aa), 0xd4, "oracle must stamp cutscene tile 0x75AA=0xD4");
  assert.equal(a.mem.read8(KIND), 0xaa, "loc_0da7 must have walked to the 0xAA terminator (0x63B3)");
  assert.notEqual(read16(a, ADDR1), 0x0000, "loc_0da7 must have drawn at least one segment (0x63AB tile address)");
  assert.ok(stackDiffs > 0, "the oracle's push/pop must land in STACK_SCRATCH (so excluding it is load-bearing)");

  // The crafted SP's margin must cover the oracle's deepest push (SP-6) AND the idiomatic
  // side's highest unmatched sub_2ff0 pop (SP+4), so excluding the stack scratch below the entry SP cannot mask a
  // game-visible divergence.
  assert.ok((SP_CRAFT - 6) >= STACK_SCRATCH.lo && (SP_CRAFT + 4) <= STACK_SCRATCH.hi,
    `crafted SP must leave push/pop headroom inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);
  console.log("  STRUCTURE: game-visible RAM identical (stackDiffs>0); playfield drawn + all outputs written");
});

// -- 2. INTRO_STEP (exhaustive) -----------------------------------------------

test("INTRO_STEP (exhaustive): setupIntroCutsceneStep == oracle over all 256 step bytes", () => {
  let count = 0, wraps = 0, mismatch = null;
  for (let s = 0; s < 256 && !mismatch; s++) {
    const [a, b] = craftPair(s);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    assert.equal(a.mem.read8(INTRO_STEP), (s + 1) & 0xff,
      `oracle must set INTRO_STEP to (step+1)&0xFF at step=${hx(s)}`);
    if (s === 0xff && a.mem.read8(INTRO_STEP) === 0x00) wraps++;
    if (bad) mismatch = { s, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at INTRO_STEP=${hx(mismatch.s)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 INTRO_STEP values");
  assert.equal(wraps, 1, "the 0xFF -> 0x00 wrap must have been exercised");
  console.log(`  INTRO_STEP/exhaustive: 256 values — full work footprint identical (incl. 0xFF->0x00 wrap)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): swaps the two walk-pointer seeds (0x63C2 gets 0x38CB, 0x63C4 gets 0x38B4).
 *  Every other write is faithful, so the first divergence is at 0x63C2. */
function brokenSwappedSeed(m) {
  const { regs, mem } = m;
  mem.write8(0x7d86, 0x00); mem.write8(0x7d87, 0x01);
  regs.de = 0x380d; loc_0da7(m);
  mem.write8(0x76a3, 0x10); mem.write8(0x7663, 0x10); mem.write8(0x75aa, 0xd4);
  mem.write8(CUTSCENE_BOOKKEEPING, 0x00);
  mem.write16(WALK_PTR_0B06, 0x38cb); // BUG: should be 0x38B4
  mem.write16(WALK_PTR_0B68, 0x38b4); // BUG: should be 0x38CB
  mem.write8(SUBSTATE_TIMER, 0x40);
  mem.write8(INTRO_STEP, (mem.read8(INTRO_STEP) + 1) & 0xff);
}

/** Twin (b): drops the `inc (INTRO_STEP)`. Everything else faithful, so INTRO_STEP stays
 *  at its input where the oracle advances it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  mem.write8(0x7d86, 0x00); mem.write8(0x7d87, 0x01);
  regs.de = 0x380d; loc_0da7(m);
  mem.write8(0x76a3, 0x10); mem.write8(0x7663, 0x10); mem.write8(0x75aa, 0xd4);
  mem.write8(CUTSCENE_BOOKKEEPING, 0x00);
  mem.write16(WALK_PTR_0B06, 0x38b4);
  mem.write16(WALK_PTR_0B68, 0x38cb);
  mem.write8(SUBSTATE_TIMER, 0x40);
  // BUG: no INTRO_STEP advance
}

test("TEETH (swapped-seed): swapping the two walk-pointer seeds is CAUGHT and names 0x63C2", () => {
  const [a, b] = craftPair(0);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenSwappedSeed(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the RAM gate FAILED to catch a swapped walk-pointer seed — it is worthless");
  assert.equal(bad.addr, WALK_PTR_0B06, `expected the caught diff at 0x63C2, got ${hx(bad.addr)}`);
  console.log(`  TEETH/swapped-seed: caught at 0x63C2 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (drop-advance): the dropped INTRO_STEP inc is CAUGHT by the sweep and names 0x6385", () => {
  let caught = null;
  for (let s = 0; s < 256 && !caught; s++) {
    const [a, b] = craftPair(s);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenNoAdvance(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { s, bad };
  }
  assert.notEqual(caught, null, "the INTRO_STEP sweep FAILED to catch a dropped advance — it is worthless");
  assert.equal(caught.bad.addr, INTRO_STEP, `expected the caught diff at 0x6385, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at INTRO_STEP=${hx(caught.s)} (0x6385 oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

// -- 4. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x0a8a dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(6000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x0a8a dispatches in 6000 attract frames — the intro cutscene is a credited game's per-board head; crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x0a8a dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
