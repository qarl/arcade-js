// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runIntroClimbStep (ROM 0x0ABF) — step 1 of the opening
 * Kong-climb cutscene: a timer-gated one-shot that stages the next climb pose.
 *
 * runIntroClimbStep WRITES memory and is NOT a leaf — it runs the rst-0x18 gate
 * (tickSubstateTimer), the rst-0x38 add-passes (the frozen oracle loc_0038), and the
 * block copy (loadSpriteObjectBlock) — so it is gated by capture / clone / replay
 * (docs/decompiler-pipeline) with a FRESH clone per case. Its logic is (a) the timer gate — only the
 * frame SUBSTATE_TIMER (0x6009) decrements to 0 does the body run — and (b) an otherwise
 * DETERMINISTIC body: the copy overwrites 0x6908..0x692F from a fixed ROM template, so
 * the only input-dependent output is the `inc (INTRO_STEP)` at the tail.
 *
 * A 6000-frame attract run dispatches 0x0abf ZERO times (the intro cutscene is a
 * credited game's per-board head, GAME_SUBSTATE 7), so — exactly as docs/decompiler-pipeline prescribes
 * for arms attract never reaches — the gate is CRAFTED: a real booted attract machine,
 * cloned, with the input bytes surgically poked, then oracle-vs-idiomatic on independent
 * fresh clones. Because the logic inputs are small, the crafted sweeps are EXHAUSTIVE:
 *
 *   1. STRUCTURE — on a crafted expiry entry, confirm game-visible RAM is identical and
 *      the oracle's push targets land inside STACK_SCRATCH (so excluding stack cannot mask
 *      a real diff). On an ABORT entry the idiomatic side takes only the clean rst-0x18
 *      leaf, so it must leave SP and pc untouched — asserted. (On the WORK branch it calls
 *      the still-raw oracle loc_0038, which pops the Z80 stack; that churn is confined to
 *      STACK_SCRATCH and SP/pc are deliberately not part of the memory contract.)
 *
 *   2. TIMER (exhaustive) — sweep SUBSTATE_TIMER 0..255. Only value 1 expires (runs the
 *      full body, incl. INTRO_STEP -> +1); every other value just decrements 0x6009 and
 *      leaves the body untouched. Both arms asserted, game-visible RAM identical over all.
 *
 *   3. INTRO_STEP (exhaustive) — at the expiry value (timer 1) sweep INTRO_STEP 0..255.
 *      Pins the `inc` (result = (step+1)&0xFF, incl. the 0xFF->0x00 wrap) over every
 *      possible step byte, with the full 44-byte work footprint identical each time.
 *
 *   4. TEETH — two twins the sweeps MUST catch: (a) a WRITE-ORDER corruption that zeroes
 *      0x690C before the add-passes instead of after (so add-pass 1 re-adds 0x30), caught
 *      naming 0x690C; (b) a dropped INTRO_STEP `inc`, caught by the INTRO_STEP sweep
 *      naming 0x6385.
 *
 *   5. REALISM — hook 0x0abf over a long attract run; replay any real dispatch if one
 *      occurs, else record that attract never reaches this cutscene (why crafted is the gate).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0abf.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0abf as oracle } from "../../translated/loc_0abf.js";
import { runIntroClimbStep as idiomatic } from "../runIntroClimbStep.js";
import { tickSubstateTimer } from "../tickSubstateTimer.js";
import { loadSpriteObjectBlock } from "../loadSpriteObjectBlock.js";
import { loc_0038 } from "../../translated/loc_0038.js";
import { Machine } from "../../machine.js";
import {
  STACK_SCRATCH, SUBSTATE_TIMER, INTRO_STEP,
  SND_PRIORITY, SND_PRIORITY_FRAMES, SPRITE_OBJ_BLOCK,
} from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0abf;
const CUTSCENE_BYTE_638E = 0x638e;
const SP_CRAFT = 0x6bf8; // inside STACK_SCRATCH; headroom for the oracle's pushes AND for
                         //   the idiomatic side's two unmatched loc_0038 pops (SP -> 0x6bfc).
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
// entry (cloned per case, never mutated). Genuine work RAM; only the inputs move.
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

/** Two independent fresh clones of the base with identical input pokes (docs/decompiler-pipeline fresh
 *  clone per case — this routine writes RAM). Returns [oracleClone, candidateClone]. */
function craftPair(timer, step) {
  const a = base().clone(), b = base().clone();
  for (const m of [a, b]) {
    m.mem.write8(SUBSTATE_TIMER, timer);
    m.mem.write8(INTRO_STEP, step);
    m.regs.sp = SP_CRAFT;
  }
  return [a, b];
}

// -- 1. STRUCTURE -------------------------------------------------------------

test("STRUCTURE: crafted expiry entry — work RAM identical; ABORT entry leaves SP/pc untouched", () => {
  // WORK branch (timer 1): game-visible RAM identical to the oracle.
  const [a, b] = craftPair(1, 1);
  const aFloor = a.regs.sp;
  oracle(a);
  idiomatic(b);
  const { bad, stackDiffs } = ramDiffMinusStack(a, b, aFloor);
  assert.equal(bad, null, bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);

  // The oracle actually did the work — confirm the salient outputs so an EQUAL result is
  // not vacuous (the body wrote something).
  assert.equal(a.mem.read8(INTRO_STEP), 2, "oracle must advance INTRO_STEP 1 -> 2 on expiry");
  assert.equal(a.mem.read8(SND_PRIORITY), 0x01, "oracle must queue the intro tune (SND_PRIORITY=1)");
  assert.equal(a.mem.read8(SND_PRIORITY_FRAMES), 0x03, "oracle must set the 3-frame pulse");
  assert.equal(a.mem.read8(CUTSCENE_BYTE_638E), 0x1f, "oracle must seed 0x638E=0x1F");
  assert.equal(a.mem.read8(SPRITE_OBJ_BLOCK + 4), 0x00, "oracle must zero 0x690C AFTER the add-passes");
  assert.ok(stackDiffs > 0, "the oracle's pushes must land in STACK_SCRATCH (so the exclusion is load-bearing)");

  // The oracle's push16 writes [SP-2, SP-1]; both must sit in STACK_SCRATCH, and the
  // idiomatic side's unmatched loc_0038 pops climb only to SP+4 — also inside the region.
  assert.ok((SP_CRAFT - 2) >= STACK_SCRATCH.lo && (SP_CRAFT + 4) <= STACK_SCRATCH.hi,
    `oracle push / idiomatic pop targets must stay inside STACK_SCRATCH (SP=${hx(SP_CRAFT)})`);

  // ABORT branch (timer 5): idiomatic takes only the clean rst-0x18 leaf, so it models
  // neither stack nor return — SP and pc unchanged from entry.
  const c = base().clone();
  c.mem.write8(SUBSTATE_TIMER, 5); c.regs.sp = SP_CRAFT;
  const sp0 = c.regs.sp, pc0 = c.pc;
  idiomatic(c);
  assert.equal(c.regs.sp, sp0, "on the abort branch runIntroClimbStep must leave SP unchanged");
  assert.equal(c.pc, pc0, "on the abort branch runIntroClimbStep must leave pc unchanged");
  assert.equal(c.mem.read8(SUBSTATE_TIMER), 4, "abort branch must still decrement SUBSTATE_TIMER");
  console.log("  STRUCTURE: work-branch RAM identical (stackDiffs>0); abort branch touches no SP/pc");
});

// -- 2. TIMER (exhaustive) ----------------------------------------------------

test("TIMER (exhaustive): runIntroClimbStep == oracle over all 256 SUBSTATE_TIMER values", () => {
  let count = 0, expired = 0, counting = 0, mismatch = null;
  for (let t = 0; t < 256 && !mismatch; t++) {
    const [a, b] = craftPair(t, 1); // step 1 = the natural INTRO_STEP for this handler
    const aFloor = a.regs.sp;
    oracle(a);
    idiomatic(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    count++;
    // Classify from the oracle: expiry advances INTRO_STEP (1 -> 2); counting leaves it at 1.
    if (a.mem.read8(INTRO_STEP) !== 1) expired++; else counting++;
    if (bad) mismatch = { t, bad };
  }
  assert.equal(mismatch, null,
    mismatch && `mismatch at SUBSTATE_TIMER=${hx(mismatch.t)}: RAM diff at ` +
      `${hx(mismatch.bad.addr)} (oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`);
  assert.equal(count, 256, "must have swept all 256 timer values");
  assert.equal(expired, 1, "exactly one value (1) must expire and run the body");
  assert.equal(counting, 255, "the other 255 values must merely count down");
  console.log(`  TIMER/exhaustive: 256 values — game-visible RAM identical (1 expiry, 255 counting)`);
});

// -- 3. INTRO_STEP (exhaustive) -----------------------------------------------

test("INTRO_STEP (exhaustive): at expiry, runIntroClimbStep == oracle over all 256 step bytes", () => {
  let count = 0, wraps = 0, mismatch = null;
  for (let s = 0; s < 256 && !mismatch; s++) {
    const [a, b] = craftPair(1, s); // timer 1 forces the body / the `inc (INTRO_STEP)` path
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
  console.log(`  INTRO_STEP/exhaustive: 256 values — full 44-byte work footprint identical (incl. 0xFF->0x00 wrap)`);
});

// -- 4. TEETH -----------------------------------------------------------------

/** Twin (a): zeroes 0x690C BEFORE the add-passes instead of after, so add-pass 1 re-adds
 *  0x30 into it. Every other write is faithful, so the ONLY divergence is 0x690C. */
function brokenWriteOrder(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = 0x388c; loadSpriteObjectBlock(m);
  mem.write8(SPRITE_OBJ_BLOCK + 4, 0x00); // BUG: zeroed before the add-passes
  regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0x30; loc_0038(m);
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0x99; loc_0038(m);
  mem.write8(CUTSCENE_BYTE_638E, 0x1f);
  mem.write8(SND_PRIORITY, 0x01); mem.write8(SND_PRIORITY_FRAMES, 0x03);
  mem.write8(INTRO_STEP, (mem.read8(INTRO_STEP) + 1) & 0xff);
}

/** Twin (b): drops the `inc (INTRO_STEP)`. Everything else faithful, so on the expiry
 *  frame INTRO_STEP stays at its input where the oracle advances it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  if (!tickSubstateTimer(m)) return;
  regs.hl = 0x388c; loadSpriteObjectBlock(m);
  regs.hl = SPRITE_OBJ_BLOCK; regs.c = 0x30; loc_0038(m);
  regs.hl = SPRITE_OBJ_BLOCK + 3; regs.c = 0x99; loc_0038(m);
  mem.write8(CUTSCENE_BYTE_638E, 0x1f);
  mem.write8(SPRITE_OBJ_BLOCK + 4, 0x00);
  mem.write8(SND_PRIORITY, 0x01); mem.write8(SND_PRIORITY_FRAMES, 0x03);
  // BUG: no INTRO_STEP advance
}

test("TEETH (write-order): zeroing 0x690C before the add-passes is CAUGHT and names 0x690C", () => {
  const [a, b] = craftPair(1, 1);
  const aFloor = a.regs.sp;
  oracle(a);
  brokenWriteOrder(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "the work sweep FAILED to catch a write-order corruption — it is worthless");
  assert.equal(bad.addr, SPRITE_OBJ_BLOCK + 4, `expected the caught diff at 0x690C, got ${hx(bad.addr)}`);
  console.log(`  TEETH/write-order: caught at 0x690C (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH (drop-advance): the dropped INTRO_STEP inc is CAUGHT by the sweep and names 0x6385", () => {
  let caught = null;
  for (let s = 0; s < 256 && !caught; s++) {
    const [a, b] = craftPair(1, s);
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

// -- 5. REALISM (attract capture, if any) -------------------------------------

test("REALISM: replay any real 0x0abf dispatch; else record that attract never reaches it", () => {
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
    console.log("  REALISM: 0 real 0x0abf dispatches in 6000 attract frames — the intro cutscene is a credited game's per-board head; crafted sweeps are the gate");
  } else {
    console.log(`  REALISM: ${caps.length} real 0x0abf dispatch(es) — game-visible RAM identical to the oracle`);
  }
});
