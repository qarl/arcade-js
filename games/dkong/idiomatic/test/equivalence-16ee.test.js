// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for reloadObjectBlockAndAdvanceStep (ROM 0x16EE) — a board-advance
 * phase (GAME_SUBSTATE 0x16) that reloads the sprite-object block from a ROM template,
 * patches three record fields, clears a bookkeeping byte, and advances the 0x6388 step.
 *
 * The routine WRITES memory and is NOT a leaf — it calls the landed idiomatic leaf
 * loadSpriteObjectBlock (0x004E) — so it is gated by clone / replay (docs/decompiler-pipeline) with a
 * FRESH clone per case. Its body is almost entirely CONSTANT: the copy overwrites
 * 0x6908..0x692F from the fixed ROM template at 0x388C, then the patches and the 0x62AF
 * clear are fixed values, so the ONLY input-dependent output is the tail `inc (0x6388)`.
 *
 * A long attract run dispatches 0x16ee ZERO times (attract never completes a board, so
 * sub-state 0x16 is never entered), so — exactly as docs/decompiler-pipeline prescribes for arms attract
 * never reaches — the gate is CRAFTED: a real booted attract machine, cloned, with the
 * one input byte (0x6388) surgically poked, then oracle-vs-idiomatic on independent fresh
 * clones. Because the only logic input is 0x6388, the crafted sweep is EXHAUSTIVE:
 *
 *   1. STRUCTURE — on a crafted entry, confirm game-visible RAM (RAM − the stack scratch below the entry SP) is
 *      identical, and that the oracle actually did the work (block copied from ROM, the
 *      three patches applied, 0x62AF cleared, 0x6388 incremented) so an EQUAL result is not
 *      vacuous. The oracle's own `call 0x004e` / `ret` stack traffic is confined to
 *      STACK_SCRATCH by the crafted SP, so excluding stack cannot mask a real diff.
 *
 *   2. STEP (exhaustive) — sweep 0x6388 0..255 at the entry. Pins the `inc` (result =
 *      (step+1)&0xFF, incl. the 0xFF->0x00 wrap) over every possible step byte, with the
 *      full copy+patch footprint identical each time.
 *
 *   3. TEETH — three twins the gate MUST catch: (a) a WRITE-ORDER corruption that patches
 *      0x690C BEFORE the copy (so the copy's ROM byte 0x00 wins over 0x66), caught naming
 *      0x690C; (b) a dropped 0x6388 `inc`, caught by the STEP sweep naming 0x6388; (c) a
 *      dropped 0x62AF clear, caught naming 0x62AF (the crafted base pokes 0x62AF non-zero
 *      so the routine's unconditional clear is observable, not vacuous).
 *
 *   4. REALISM — hook 0x16ee over a long attract run; replay any real dispatch if one
 *      occurs, else record that attract never reaches this board-advance phase (why
 *      crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-16ee.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_16ee as oracle } from "../../translated/loc_16ee.js";
import { reloadObjectBlockAndAdvanceStep as idiomatic } from "../reloadObjectBlockAndAdvanceStep.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x16ee;
const OBJECT_RECORDS_SRC = 0x388c; // ROM template the block is copied from
const BOARD_OBJECT_SCRATCH = 0x62af;
const BOARD_ADVANCE_STEP = 0x6388;
const P690C = SPRITE_OBJ_BLOCK + 0x04; // 0x690C
const P6924 = SPRITE_OBJ_BLOCK + 0x1c; // 0x6924
const P692C = SPRITE_OBJ_BLOCK + 0x24; // 0x692C
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH; headroom for the oracle's call/ret traffic
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead
 * stack-scratch region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
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

// A real booted attract machine, built once and reused as the base for every crafted
// entry (cloned per case, never mutated). Genuine work RAM; only the input byte moves.
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

/** Two independent fresh clones of the base with the same input poke (docs/decompiler-pipeline fresh clone
 *  per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(step) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(BOARD_ADVANCE_STEP, step);
    // Seed 0x62AF non-zero so the routine's UNCONDITIONAL clear is observable: with the
    // attract base already 0 here, asserting ==0 after the run would be vacuous (couldn't
    // tell a real clear from a dropped one). 0x5A is written identically on both sides, so
    // any post-run diff at 0x62AF is a genuine behavioural divergence, not a crafted one.
    m.mem.write8(BOARD_OBJECT_SCRATCH, 0x5a);
    m.regs.sp = SP_CRAFT; // keep the oracle's call/ret stack traffic inside STACK_SCRATCH
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: crafted entry — game-visible RAM identical; oracle actually did the work", () => {
  const [a, b] = craftPair(0x10);
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // Non-vacuous: confirm the salient outputs on the oracle side.
  // (a) the block copy landed — bytes NOT overwritten by a patch match the ROM template.
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK + 0), ROM[OBJECT_RECORDS_SRC + 0],
    "oracle must copy record 0 field 0 from the ROM template");
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK + 3), ROM[OBJECT_RECORDS_SRC + 3],
    "oracle must copy record 0 field 3 from the ROM template");
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK + 0x27), ROM[OBJECT_RECORDS_SRC + 0x27],
    "oracle must copy the last block byte from the ROM template");
  // (b) the three field patches + the bookkeeping clear.
  assert.equal(a.mem.read8(P690C), 0x66, "oracle must patch 0x690C to 0x66 AFTER the copy");
  assert.equal(a.mem.read8(P6924), 0x00, "oracle must clear 0x6924");
  assert.equal(a.mem.read8(P692C), 0x00, "oracle must clear 0x692C");
  assert.equal(a.mem.read8(BOARD_OBJECT_SCRATCH), 0x00, "oracle must clear 0x62AF (0x5A -> 0)");
  // (c) the step advance.
  assert.equal(a.mem.read8(BOARD_ADVANCE_STEP), 0x11, "oracle must advance 0x6388 0x10 -> 0x11");
  // The patch values differ from the template so the copy genuinely happened first.
  assert.notEqual(ROM[OBJECT_RECORDS_SRC + 0x04], 0x66, "template@+4 must differ from the 0x66 patch (write-order matters)");
  assert.ok(stackDiffs > 0, "the oracle's call/ret stack traffic must land in STACK_SCRATCH (so the exclusion is load-bearing)");

  // The oracle's stack traffic stays inside STACK_SCRATCH at the crafted SP.
  assert.ok((SP_CRAFT - 2) >= STACK_SCRATCH.lo && (SP_CRAFT + 2) <= STACK_SCRATCH.hi,
    `oracle push/pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);
  console.log("  STRUCTURE: game-visible RAM identical; copy+patch+clear+advance all executed (stackDiffs>0)");
});

// -- 2. STEP (exhaustive) -----------------------------------------------------

test("STEP (exhaustive): reload==oracle over all 256 values of 0x6388", () => {
  let count = 0, wraps = 0, mismatch = null;
  for (let s = 0; s < 256 && !mismatch; s++) {
    const [a, b] = craftPair(s);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    assert.equal(a.mem.read8(BOARD_ADVANCE_STEP), (s + 1) & 0xff,
      `oracle must set 0x6388 to (step+1)&0xFF at step=${hx(s)}`);
    if (s === 0xff && a.mem.read8(BOARD_ADVANCE_STEP) === 0x00) wraps++;
    if (bad) mismatch = { s, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at 0x6388=${hx(mismatch.s)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 step values");
  assert.equal(wraps, 1, "the 0xFF -> 0x00 wrap must have been exercised");
  console.log(`  STEP/exhaustive: 256 values — full copy+patch footprint identical (incl. 0xFF->0x00 wrap)`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): patches 0x690C BEFORE the copy, so the copy's ROM byte (0x00) overwrites the
 *  0x66 patch. Every other write is faithful, so the ONLY divergence is 0x690C. */
function brokenWriteOrder(m) {
  const { regs, mem } = m;
  mem.write8(P690C, 0x66); // BUG: patched before the copy
  regs.hl = OBJECT_RECORDS_SRC;
  loadSpriteObjectBlock(m);
  mem.write8(P6924, 0x00);
  mem.write8(P692C, 0x00);
  mem.write8(BOARD_OBJECT_SCRATCH, 0x00);
  mem.write8(BOARD_ADVANCE_STEP, (mem.read8(BOARD_ADVANCE_STEP) + 1) & 0xff);
}

/** Twin (b): drops the `inc (0x6388)`. Everything else faithful, so 0x6388 stays at its
 *  input where the oracle advances it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  regs.hl = OBJECT_RECORDS_SRC;
  loadSpriteObjectBlock(m);
  mem.write8(P690C, 0x66);
  mem.write8(P6924, 0x00);
  mem.write8(P692C, 0x00);
  mem.write8(BOARD_OBJECT_SCRATCH, 0x00);
  // BUG: no 0x6388 advance
}

/** Twin (c): drops the 0x62AF clear. Everything else faithful, so 0x62AF stays at its
 *  crafted non-zero input (0x5A) where the oracle clears it to 0. */
function brokenNoClear(m) {
  const { regs, mem } = m;
  regs.hl = OBJECT_RECORDS_SRC;
  loadSpriteObjectBlock(m);
  mem.write8(P690C, 0x66);
  mem.write8(P6924, 0x00);
  mem.write8(P692C, 0x00);
  // BUG: no 0x62AF clear
  mem.write8(BOARD_ADVANCE_STEP, (mem.read8(BOARD_ADVANCE_STEP) + 1) & 0xff);
}

test("TEETH (write-order): patching 0x690C before the copy is CAUGHT and names 0x690C", () => {
  const [a, b] = craftPair(0x10);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWriteOrder(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted gate FAILED to catch a write-order corruption — it is worthless");
  assert.equal(bad.addr, P690C, `expected the caught diff at 0x690C, got ${hx(bad.addr)}`);
  console.log(`  TEETH/write-order: caught at 0x690C (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (drop-advance): the dropped 0x6388 inc is CAUGHT by the STEP sweep and names 0x6388", () => {
  let caught = null;
  for (let s = 0; s < 256 && !caught; s++) {
    const [a, b] = craftPair(s);
    const aFloor = a.regs.sp;
    oracle(a);
    brokenNoAdvance(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    if (bad) caught = { s, bad };
  }
  assert.notEqual(caught, null, "the STEP sweep FAILED to catch a dropped advance — it is worthless");
  assert.equal(caught.bad.addr, BOARD_ADVANCE_STEP, `expected the caught diff at 0x6388, got ${hx(caught.bad.addr)}`);
  console.log(`  TEETH/drop-advance: caught at 0x6388 step=${hx(caught.s)} (oracle=${caught.bad.a} broken=${caught.bad.b})`);
});

test("TEETH (drop-clear): the dropped 0x62AF clear is CAUGHT and names 0x62AF", () => {
  const [a, b] = craftPair(0x10);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenNoClear(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted gate FAILED to catch a dropped 0x62AF clear — it is worthless");
  assert.equal(bad.addr, BOARD_OBJECT_SCRATCH, `expected the caught diff at 0x62AF, got ${hx(bad.addr)}`);
  console.log(`  TEETH/drop-clear: caught at 0x62AF (oracle=${bad.a} broken=${bad.b})`);
});

// -- 4. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x16ee dispatch; else record that attract never reaches it", () => {
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
    console.log("  REALISM: 0 real 0x16ee dispatches in 6000 attract frames — attract never completes a board (sub-state 0x16 unreached); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x16ee dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
