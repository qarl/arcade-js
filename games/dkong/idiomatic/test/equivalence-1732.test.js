// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for climbKongFigureAndBreakHeart (ROM 0x1732) — animation-gated step 3 of the board-advance
 * render sequence (GAME_SUBSTATE 0x600A == 0x16, step selector 0x6388 == 3 on 25m/75m).
 *
 * climbKongFigureAndBreakHeart WRITES memory and is NOT a leaf — every frame it ticks animateSpriteObjectBlock
 * (ROM 0x306f, itself already idiomatic and memory-validated), then branches on the scrolled
 * result — so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case.
 * The oracle reaches 0x306f through `m.call`, which on a no-override machine resolves to the
 * frozen translated sub_306f, so the oracle side is (frozen climbKongFigureAndBreakHeart ∘ frozen sub_306f) and
 * the candidate side is (climbKongFigureAndBreakHeart ∘ idiomatic animateSpriteObjectBlock) — a faithful bottom-up
 * composition. Its logic has two inputs:
 *   - 0x62AF — animateSpriteObjectBlock's private 1-in-8 phase counter. On the 32 values with
 *     (phase+1)&7 == 0 the animation body runs and scrolls the ten-record group up 4px (so the
 *     0x6913 probe drops by 4); the other 224 only tick the phase counter.
 *   - 0x6913 — sprite-object record 2's Y (the scroll probe). AFTER the tick, Y >= 0x2c HOLDS
 *     (return), Y < 0x2c finishes the step (park X bytes, reposition records 7/9, bump 0x6A21,
 *     advance the 0x6388 step selector).
 *
 * A long attract run dispatches 0x1732 ZERO times (attract never completes a board, so it never
 * reaches GAME_SUBSTATE 0x16) — so, exactly as docs/decompiler-pipeline prescribes for arms attract never
 * reaches, the gate is CRAFTED: a real booted attract machine, cloned, with the input bytes
 * surgically poked (plus sentinels on the reset targets so EQUAL is never vacuous), then
 * oracle-vs-idiomatic on independent fresh clones. The inputs are small, so the sweeps are
 * EXHAUSTIVE:
 *
 *   1. STRUCTURE — a crafted RESET entry (Y=0x20, non-stepping phase): game-visible RAM
 *      identical, the oracle's salient reset outputs asserted (X bytes zeroed, records 7/9 set,
 *      0x6A21 + 0x6388 incremented), the oracle's push/pop lands in STACK_SCRATCH (so excluding
 *      stack cannot mask a real diff), and the idiomatic side (direct call, no stack) leaves
 *      SP/pc untouched. A HOLD entry (Y=0x40) confirms only the phase counter moved. A STEPPING
 *      entry (phase=0x07) confirms the animateSpriteObjectBlock composition: the block scrolls
 *      and the probe drops by 4, and RAM stays identical across the whole animator.
 *
 *   2. GATE (exhaustive) — non-stepping phase, sweep the 0x6913 gate byte 0..255. Exactly the
 *      44 values < 0x2c reset + advance the step; the other 212 hold. Game-visible RAM identical
 *      to the oracle for every value, and the partition is asserted against 0x6388.
 *
 *   3. PHASE (exhaustive) — with Y = 0x2E (drops to 0x2A when the body steps), sweep 0x62AF
 *      0..255. Exactly the 32 stepping values scroll the block and flip the branch to RESET; the
 *      other 224 hold. This drives animateSpriteObjectBlock through all phases (incl. the 8-bit
 *      wrap) inside the composition; RAM identical to the oracle throughout.
 *
 *   4. TEETH — two twins the sweeps MUST catch: (a) a WRONG-THRESHOLD twin (holds on `> 0x2c`
 *      instead of `>= 0x2c`, i.e. resets at Y == 0x2C where the oracle holds), caught by the GATE
 *      sweep at 0x6913 == 0x2C naming 0x6388; (b) a WRONG-RESET-VALUE twin (writes 0x6924 = 0x6A
 *      instead of 0x6B), caught on any reset case naming 0x6924.
 *
 *   5. REALISM — hook 0x1732 over a long attract run; replay any real dispatch, else record that
 *      attract never reaches this interlude (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-1732.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1732 as oracle } from "../../translated/loc_1732.js";
import { climbKongFigureAndBreakHeart as idiomatic } from "../climbKongFigureAndBreakHeart.js";
import { animateSpriteObjectBlock } from "../animateSpriteObjectBlock.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH, SPRITE_BUFFER, SPRITE_OBJ_BLOCK } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x1732;
const PHASE_COUNTER = 0x62af; // animateSpriteObjectBlock's private 1-in-8 phase counter
const SCROLL_PROBE = SPRITE_OBJ_BLOCK + 0x0b; // 0x6913 — sprite-object record 2's Y
const SCROLL_TOP = 0x2c;
const STEP_SELECTOR = 0x6388;
const X0 = SPRITE_BUFFER + 0x00; // 0x6900
const X1 = SPRITE_BUFFER + 0x04; // 0x6904
const XOBJ1 = SPRITE_OBJ_BLOCK + 0x04; // 0x690c
const XOBJ7 = SPRITE_OBJ_BLOCK + 0x1c; // 0x6924
const XOBJ9 = SPRITE_OBJ_BLOCK + 0x24; // 0x692c
const CODE_BYTE = SPRITE_BUFFER + 0x121; // 0x6a21
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH; headroom for the oracle's nested push/pop

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// A non-stepping phase leaves the animation body dormant (probe unchanged): (0+1)&7 != 0.
const PHASE_HOLD = 0x00;
// A stepping phase runs the body once: (0x07+1)&7 == 0.
const PHASE_STEP = 0x07;
const stepsAnim = (phase) => (((phase + 1) & 0xff) & 0x07) === 0;

/**
 * First game-visible differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP).
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

// A real booted attract machine, built once and reused as the base for every crafted entry
// (cloned per case, never mutated). Genuine work RAM; only the inputs + sentinels move.
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

// Sentinels poked onto the reset targets so that "oracle zeroed / advanced it" is a real
// observation, never a value that happened to already be there in the (all-zero) block.
const S_X = 0xee; // parked-to-0 X bytes
const S_CODE = 0x40; // inc'd code byte -> 0x41
const S_STEP = 0x40; // inc'd step selector -> 0x41

/** Two independent fresh clones of the base with identical input pokes + sentinels (docs/decompiler-pipeline
 *  fresh clone per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(y, phase) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(X0, S_X); m.mem.write8(X1, S_X); m.mem.write8(XOBJ1, S_X);
    m.mem.write8(XOBJ7, 0x11); m.mem.write8(XOBJ9, 0x11);
    m.mem.write8(CODE_BYTE, S_CODE); m.mem.write8(STEP_SELECTOR, S_STEP);
    m.mem.write8(SCROLL_PROBE, y); m.mem.write8(PHASE_COUNTER, phase);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// The oracle's step advances the selector off its sentinel; a hold leaves it at S_STEP.
const oracleReset = (m) => m.mem.read8(STEP_SELECTOR) !== S_STEP;

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: reset / hold / stepping — work RAM identical, salient outputs asserted, idiomatic touches no SP/pc", () => {
  // RESET (Y < 0x2c, non-stepping phase): the full finish branch runs.
  const [a, b] = craftPair(0x20, PHASE_HOLD);
  const aFloor = a.regs.sp;
  const sp0 = b.regs.sp, pc0 = b.pc;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `reset RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle actually finished the step — assert the salient outputs so EQUAL is not vacuous.
  assert.equal(a.mem.read8(X0), 0x00, "oracle must park 0x6900 (record 0 X) to 0");
  assert.equal(a.mem.read8(X1), 0x00, "oracle must park 0x6904 (record 1 X) to 0");
  assert.equal(a.mem.read8(XOBJ1), 0x00, "oracle must park 0x690c (obj record 1 X) to 0");
  assert.equal(a.mem.read8(XOBJ7), 0x6b, "oracle must set 0x6924 (obj record 7 X) to 0x6b");
  assert.equal(a.mem.read8(XOBJ9), 0x6a, "oracle must set 0x692c (obj record 9 X) to 0x6a");
  assert.equal(a.mem.read8(CODE_BYTE), (S_CODE + 1) & 0xff, "oracle must inc the 0x6a21 code byte");
  assert.equal(a.mem.read8(STEP_SELECTOR), (S_STEP + 1) & 0xff, "oracle must advance the 0x6388 step");
  assert.ok(stackDiffs > 0, "the oracle's push/pop must land in STACK_SCRATCH (so the exclusion is load-bearing)");
  assert.ok((SP_CRAFT - 8) >= STACK_SCRATCH.lo && SP_CRAFT <= STACK_SCRATCH.hi,
    `oracle push/pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // The idiomatic side makes only direct calls — it models no stack and no return.
  assert.equal(b.regs.sp, sp0, "climbKongFigureAndBreakHeart must leave SP unchanged (direct call, no stack modelling)");
  assert.equal(b.pc, pc0, "climbKongFigureAndBreakHeart must leave pc unchanged");

  // HOLD (Y >= 0x2c, non-stepping phase): only the phase counter moves.
  const [c, d] = craftPair(0x40, PHASE_HOLD);
  const cFloor = c.regs.sp;
  oracle(c);
  idiomatic(d);
  const held = ramDiffMinusStack(c, d, cFloor);
  assert.equal(held.bad, null, held.bad && `hold RAM diff at ${hx(held.bad.addr)}`);
  assert.equal(c.mem.read8(STEP_SELECTOR), S_STEP, "hold must NOT advance the step selector");
  assert.equal(c.mem.read8(XOBJ7), 0x11, "hold must NOT touch 0x6924");
  assert.equal(c.mem.read8(PHASE_COUNTER), (PHASE_HOLD + 1) & 0xff, "hold must still tick the phase counter");

  // STEPPING (phase 0x07): the animation body runs — exercises the animateSpriteObjectBlock
  // composition. Y=0x40 drops to 0x3c (still >= 0x2c) so it HOLDS after scrolling.
  const [e, f] = craftPair(0x40, PHASE_STEP);
  const eFloor = e.regs.sp;
  oracle(e);
  idiomatic(f);
  const stepped = ramDiffMinusStack(e, f, eFloor);
  assert.equal(stepped.bad, null, stepped.bad && `stepping RAM diff at ${hx(stepped.bad.addr)}`);
  assert.equal(e.mem.read8(PHASE_COUNTER), (PHASE_STEP + 1) & 0xff, "stepping must advance the phase counter to 0x08");
  assert.equal(e.mem.read8(SCROLL_PROBE), 0x3c, "the animation body must scroll the probe 0x40 -> 0x3c (-4)");
  assert.equal(e.mem.read8(STEP_SELECTOR), S_STEP, "0x40->0x3c is still >= 0x2c, so the step must HOLD");
  console.log("  STRUCTURE: reset work RAM identical (stackDiffs>0); hold ticks phase only; stepping scrolls -4 then holds");
});

// -- 2. GATE (exhaustive) -----------------------------------------------------

test("GATE (exhaustive): climbKongFigureAndBreakHeart == oracle over all 256 gate bytes (non-stepping phase)", () => {
  let count = 0, resets = 0, holds = 0, mismatch = null, partition = null;
  for (let y = 0; y < 256 && !mismatch; y++) {
    const [a, b] = craftPair(y, PHASE_HOLD);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    const reset = oracleReset(a);
    // Non-stepping phase leaves the probe at y; the oracle resets iff y < 0x2c.
    if (reset && y < SCROLL_TOP) resets++;
    else if (!reset && y >= SCROLL_TOP) holds++;
    else if (!partition) partition = { y, reset };
    if (bad) mismatch = { y, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at 0x6913=${hx(mismatch.y)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(partition, null,
    partition && `oracle branch disagreed with the Y<0x2c rule at 0x6913=${hx(partition.y)} (reset=${partition.reset})`);
  assert.equal(count, 256, "must have swept all 256 gate values");
  assert.equal(resets, 0x2c, "exactly the 44 values < 0x2c must reset + advance the step");
  assert.equal(holds, 256 - 0x2c, "the other 212 values must hold");
  console.log(`  GATE/exhaustive: 256 values — RAM identical; ${resets} reset (<0x2c), ${holds} hold (>=0x2c)`);
});

// -- 3. PHASE (exhaustive) ----------------------------------------------------

test("PHASE (exhaustive): climbKongFigureAndBreakHeart == oracle over all 256 phase bytes (Y=0x2e, animator composition)", () => {
  let count = 0, stepped = 0, dormant = 0, resets = 0, mismatch = null, partition = null;
  for (let phase = 0; phase < 256 && !mismatch; phase++) {
    const [a, b] = craftPair(0x2e, phase);
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    const reset = oracleReset(a);
    if (reset) resets++;
    // A stepping phase scrolls 0x2e -> 0x2a (< 0x2c) so it RESETS; a dormant one holds at 0x2e.
    if (stepsAnim(phase)) { stepped++; if (!reset && !partition) partition = { phase, reset }; }
    else { dormant++; if (reset && !partition) partition = { phase, reset }; }
    if (bad) mismatch = { phase, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at 0x62af=${hx(mismatch.phase)}: RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(partition, null,
    partition && `oracle branch disagreed with the stepping rule at 0x62af=${hx(partition.phase)} (reset=${partition.reset})`);
  assert.equal(count, 256, "must have swept all 256 phase values");
  assert.equal(stepped, 32, "exactly 32 phase values must step the animation");
  assert.equal(dormant, 224, "the other 224 must only tick the phase counter");
  assert.equal(resets, 32, "the 32 stepping values (0x2e -> 0x2a) must be exactly the ones that reset");
  console.log(`  PHASE/exhaustive: 256 values — RAM identical across the animator; ${stepped} step->reset, ${dormant} hold`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): faithful but HOLDS on `> 0x2c` instead of `>= 0x2c`, so it wrongly RESETS at
 *  Y == 0x2C (where the oracle holds). Caught by the GATE sweep at 0x6913 == 0x2C. */
function brokenWrongThreshold(m) {
  const { mem } = m;
  animateSpriteObjectBlock(m);
  if (mem.read8(SCROLL_PROBE) > SCROLL_TOP) return; // BUG: > instead of >=
  mem.write8(X0, 0x00); mem.write8(X1, 0x00); mem.write8(XOBJ1, 0x00);
  mem.write8(XOBJ7, 0x6b); mem.write8(XOBJ9, 0x6a);
  mem.write8(CODE_BYTE, (mem.read8(CODE_BYTE) + 1) & 0xff);
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
}

/** Twin (b): faithful but writes 0x6924 = 0x6A instead of 0x6B. Caught on any reset case. */
function brokenWrongResetValue(m) {
  const { mem } = m;
  animateSpriteObjectBlock(m);
  if (mem.read8(SCROLL_PROBE) >= SCROLL_TOP) return;
  mem.write8(X0, 0x00); mem.write8(X1, 0x00); mem.write8(XOBJ1, 0x00);
  mem.write8(XOBJ7, 0x6a); mem.write8(XOBJ9, 0x6a); // BUG: 0x6924 should be 0x6b
  mem.write8(CODE_BYTE, (mem.read8(CODE_BYTE) + 1) & 0xff);
  mem.write8(STEP_SELECTOR, (mem.read8(STEP_SELECTOR) + 1) & 0xff);
}

test("TEETH (wrong-threshold): resetting at Y==0x2c is CAUGHT by the GATE sweep and names 0x6388", () => {
  const [a, b] = craftPair(0x2c, PHASE_HOLD); // oracle HOLDS at exactly 0x2c
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongThreshold(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted sweep FAILED to catch a wrong threshold — it is worthless");
  assert.equal(bad.addr, STEP_SELECTOR, `expected the caught diff at 0x6388, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-threshold: caught at 0x6388 (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (wrong-reset-value): 0x6924=0x6a is CAUGHT on a reset case and names 0x6924", () => {
  const [a, b] = craftPair(0x20, PHASE_HOLD); // a reset case (Y < 0x2c)
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWrongResetValue(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the crafted case FAILED to catch a wrong reset value — it is worthless");
  assert.equal(bad.addr, XOBJ7, `expected the caught diff at 0x6924, got ${hx(bad.addr)}`);
  console.log(`  TEETH/wrong-reset-value: caught at 0x6924 (oracle=${bad.a} broken=${bad.b})`);
});

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x1732 dispatch; else record that attract never reaches it", () => {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => { if (caps.length < 16) caps.push(mm.clone()); return oracle(mm); }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(8000);

  for (const entry of caps) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(bad, null, bad && `real-dispatch RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  }
  if (caps.length === 0) {
    console.log("  REALISM: 0 real 0x1732 dispatches in 8000 attract frames — attract never completes a board (GAME_SUBSTATE 0x16); crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x1732 dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
