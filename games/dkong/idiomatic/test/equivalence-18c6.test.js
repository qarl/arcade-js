// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for runRivetBoardFinaleThenAdvanceLevel (ROM 0x18C6) — the board-advance / "how high"
 * transition pacer, driven by the 0x62AF down-counter.
 *
 * runRivetBoardFinaleThenAdvanceLevel WRITES memory (0x62AF and, per arm, the blink flags 0x6A25/0x6919, the
 * sprite/object records 0x694C-0x694F / 0x6A20-0x6A23, the sound cue, and on the
 * counter wrap BOARD/LEVEL/BOARD_SEQ_PTR/HOW_HIGH_INDEX/SUBSTATE_TIMER/GAME_SUBSTATE
 * + the task ring) and is NOT a leaf (it calls nextAnimationStep and, on the wrap, enqueueTask).
 * So it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per case:
 *
 *   REACHABILITY. 0x18C6 is NOT dispatched in plain attract — it runs only during the
 *   in-game board-advance transition, which attract never reaches. The test PROVES
 *   this (hooks 0x18C6 over an attract run and asserts 0 dispatches), so there is no
 *   "real captured 0x18C6 dispatch" to replay. Instead a real, valid mid-demo machine
 *   is captured (hook 0x2333, which fires during the 25m attract DEMO) and every entry
 *   is that real machine with a surgical, identical-both-sides poke (docs/decompiler-pipeline crafted
 *   entry). The demo runs 25m, so MARIO_X / LEVEL / the task ring are realistic; the
 *   0x62AF counter (and, per arm, MARIO_X / LEVEL / BOARD_SEQ_PTR) are poked.
 *
 *   1. COUNTER SWEEP (exhaustive crafted) — the 0x62AF counter is the routine's core
 *      input, so sweep it over ALL 256 values on a safe canonical base and compare
 *      game-visible RAM to the oracle. This hits every counter-driven arm: the wrap
 *      (0x01), the every-8th gate + proceed (multiples of 8), STAGE (0xE1->0xE0) and
 *      RECORD (0xC1->0xC0). The base fixes the sub-branch selectors (MARIO_X < 0x80,
 *      LEVEL odd, a valid non-terminator BOARD_SEQ_PTR, 0x6919 low bits safe so the
 *      nextAnimationStep selector terminates), which the targeted crafts below then flip.
 *
 *   2. STAGE arms (crafted) — at counter 0xE0, force MARIO_X < 0x80 and >= 0x80.
 *   3. RECORD arms (crafted) — at counter 0xC0, the four LEVEL-parity x MARIO_X combos.
 *   4. WRAP arms (crafted) — at counter 0x01, the normal advance and the 0x7F-terminator
 *      restart (BOARD_SEQ_PTR -> 0x3A73). The oracle's wrap models the stack (push/call/
 *      ret into STACK_SCRATCH); runRivetBoardFinaleThenAdvanceLevel delegates the enqueue to idiomatic enqueueTask
 *      and models no stack, so the ONLY residual diff is the excluded stack scratch.
 *   5. NO STACK MODELLING — runRivetBoardFinaleThenAdvanceLevel must leave SP and pc at their entry values on every
 *      arm (the oracle's push/call/ret became direct JS calls).
 *   6. TEETH — a twin whose every-8th gate masks 0x0F instead of 0x07 (a plausible
 *      misread that agrees on 240/256 counter values, diverging only on the multiples
 *      of 8 that are not multiples of 16) MUST be caught by the counter sweep.
 *
 * LIVE-OUT, cross-file and therefore recorded here rather than in the routine: memory-only. The
 * routine is a dispatch-table entry, and its caller (dispatchGameState's rst-0x28 tail) reads no
 * register or flag it leaves, so the oracle's residual A/B/C/HL/F are dead ABI. It models no stack
 * (the oracle's push/call/ret become direct JS calls), so pc and SP stay at entry — which is what
 * arm 5 asserts.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-18c6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_18c6 as oracle } from "../../translated/loc_18c6.js";
import { runRivetBoardFinaleThenAdvanceLevel } from "../runRivetBoardFinaleThenAdvanceLevel.js";
import { nextAnimationStep } from "../nextAnimationStep.js";
import { enqueueTask } from "../enqueueTask.js";
import { loc_2333 } from "../../translated/loc_2333.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x18c6;
const CAP_HOOK = 0x2333; // a routine that DOES fire in the 25m attract demo (base capture)

// RAM the routine reads/keys on (kept local so the test states its own contract).
const PACE_COUNTER = 0x62af;
const BLINK_6919 = 0x6919;
const MARIO_X = 0x6203;
const LEVEL = 0x6229;
const BOARD = 0x6227;
const BOARD_SEQ_PTR = 0x622a;
const GAME_SUBSTATE = 0x600a;
const TASK_TAIL = 0x60b0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). Returns the first
 * game-visible difference { addr, a, b } or null, plus how many bytes differed inside
 * the tolerated stack scratch.
 */
function ramDiffMinusStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState(), db = b.dumpState();
  const n = Math.min(da.length, db.length);
  let stackDiffs = 0;
  let bad = null;
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) { stackDiffs++; continue; }
    if (!bad) bad = { addr, a: da[i], b: db[i] };
  }
  return { bad, stackDiffs };
}

/** Replay one entry state through the oracle and a candidate on independent FRESH
 *  clones (the routine writes RAM), returning the diff + both machines. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Drive plain attract; capture the first real mid-demo machine at 0x2333 AND count
 * how many times 0x18C6 is dispatched (to prove it is not attract-reached). Both
 * hooks delegate to their oracle so the host run proceeds undisturbed.
 */
function captureBaseAndCountTarget(maxFrames) {
  let base = null;
  let targetCount = 0;
  const overrides = new Map([
    [CAP_HOOK, (mm) => { if (!base) base = mm.clone(); return loc_2333(mm); }],
    [TARGET, (mm) => { targetCount++; return oracle(mm); }],
  ]);
  const host = new Machine(ROM, { overrides });
  host.runFrames(maxFrames);
  return { base, targetCount };
}

let CAPTURE = null;
function capture() {
  if (!CAPTURE) CAPTURE = captureBaseAndCountTarget(1500);
  assert.ok(CAPTURE.base, "expected a real 0x2333 mid-demo capture to craft 0x18C6 entries from");
  return CAPTURE;
}

/**
 * A real mid-demo machine with the given identical-both-sides pokes applied. This is
 * the docs/decompiler-pipeline crafted entry: a captured, valid machine + a surgical nudge. Every key
 * is optional; unset RAM keeps its real captured value.
 */
function craftBase({ counter, x6919, seqptr, marioX, level } = {}) {
  const { base } = capture();
  const m = base.clone();
  if (counter !== undefined) m.mem.write8(PACE_COUNTER, counter);
  if (x6919 !== undefined) m.mem.write8(BLINK_6919, x6919);
  if (seqptr !== undefined) m.mem.write16(BOARD_SEQ_PTR, seqptr);
  if (marioX !== undefined) m.mem.write8(MARIO_X, marioX);
  if (level !== undefined) m.mem.write8(LEVEL, level);
  // Keep the tail slot free so the wrap's enqueue exercises its WRITE arm.
  m.mem.write8(0x6000 | m.mem.read8(TASK_TAIL), 0xff);
  return m;
}

// The safe canonical base for the counter sweep: MARIO_X on the left, LEVEL odd, a
// valid non-terminator board pointer, and 0x6919 low bits clear so the nextAnimationStep
// selector on the proceed arm terminates (a value with low 2 bits == 3 would hang,
// faithfully, both sides — an invalid live-in the real game never produces here).
const SWEEP_BASE = { x6919: 0x00, seqptr: 0x3a65, marioX: 0x40, level: 0x01 };

// -- 0. REACHABILITY ----------------------------------------------------------

test("REACHABILITY: 0x18C6 is not dispatched in plain attract (entries are crafted)", () => {
  const { targetCount } = capture();
  assert.equal(targetCount, 0, `expected 0 attract dispatches of 0x18C6, saw ${targetCount}`);
  console.log("  REACHABILITY: 0 attract dispatches of 0x18C6 — crafted entries on a real 0x2333 base");
});

// -- 1. COUNTER SWEEP (exhaustive crafted) ------------------------------------

test("COUNTER SWEEP (exhaustive): runRivetBoardFinaleThenAdvanceLevel == oracle over all 256 0x62AF values", () => {
  const sbase = craftBase(SWEEP_BASE);
  let count = 0;
  let mismatch = null;
  for (let v = 0; v < 256 && !mismatch; v++) {
    const a = sbase.clone(); const b = sbase.clone();
    a.mem.write8(PACE_COUNTER, v);
    b.mem.write8(PACE_COUNTER, v);
    oracle(a);
    runRivetBoardFinaleThenAdvanceLevel(b);
    const { bad } = ramDiffMinusStack(a, b, sbase.regs.sp);
    count++;
    if (bad) mismatch = { v, bad };
  }
  assert.equal(
    mismatch,
    null,
    mismatch && `mismatch at 0x62AF=${hx(mismatch.v)}: game-visible RAM diff at ${hx(mismatch.bad.addr)} ` +
      `(oracle=${mismatch.bad.a} idiomatic=${mismatch.bad.b})`,
  );
  assert.equal(count, 256, "must have swept all 256 counter values");
  console.log(`  COUNTER SWEEP: ${count} 0x62AF values — game-visible RAM identical (wrap/gate/proceed/stage/record)`);
});

// -- 2. STAGE arms (crafted, counter 0xE0) ------------------------------------

test("STAGE @0xE0: both MARIO_X halves seed the sprite record identically to the oracle", () => {
  for (const marioX of [0x40, 0x90]) {
    const entry = craftBase({ counter: 0xe1, x6919: 0x00, marioX }); // dec 0xE1 -> 0xE0
    const { bad } = replay(entry, runRivetBoardFinaleThenAdvanceLevel);
    assert.equal(
      bad,
      null,
      bad && `MARIO_X=${hx(marioX)}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  STAGE MARIO_X=${hx(marioX)}: 0x694C/0x694D/0x694F identical to the oracle`);
  }
});

// -- 3. RECORD arms (crafted, counter 0xC0) -----------------------------------

test("RECORD @0xC0: all LEVEL-parity x MARIO_X combos match the oracle", () => {
  for (const level of [0x01, 0x02]) {
    for (const marioX of [0x40, 0x90]) {
      const entry = craftBase({ counter: 0xc1, x6919: 0x00, level, marioX }); // dec 0xC1 -> 0xC0
      const { bad } = replay(entry, runRivetBoardFinaleThenAdvanceLevel);
      assert.equal(
        bad,
        null,
        bad && `LEVEL=${hx(level)} MARIO_X=${hx(marioX)}: game-visible RAM diff at ${hx(bad.addr)} ` +
          `(oracle=${bad.a} idiomatic=${bad.b})`,
      );
      console.log(`  RECORD LEVEL=${hx(level)} MARIO_X=${hx(marioX)}: sound cue + object record identical`);
    }
  }
});

// -- 4. WRAP arms (crafted, counter 0x01) -------------------------------------

test("WRAP @0-crossing: normal advance and 0x7F-terminator restart match the oracle", () => {
  const arms = [
    ["normal", 0x3a65], // [0x3a66] != 0x7F -> advance to the next entry
    ["terminator", 0x3a78], // [0x3a79] == 0x7F -> restart the L5+ group at 0x3A73
  ];
  for (const [label, seqptr] of arms) {
    const entry = craftBase({ counter: 0x01, seqptr }); // dec 0x01 -> 0 -> wrap
    // The oracle's wrap pushes/calls into the stack; those targets must sit inside
    // STACK_SCRATCH so excluding it cannot mask a real diff.
    assert.ok(
      (entry.regs.sp - 8) >= STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `oracle's wrap push targets must sit inside STACK_SCRATCH (SP=${hx(entry.regs.sp)})`,
    );
    const { bad, stackDiffs } = replay(entry, runRivetBoardFinaleThenAdvanceLevel);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    // The oracle really used the stack; the idiomatic delegate did not, so the diff
    // must be confined to the excluded stack scratch (proving the exclusion earns its keep).
    assert.ok(stackDiffs > 0, `${label}: expected the oracle's push to differ inside STACK_SCRATCH`);
    const post = replay(entry, runRivetBoardFinaleThenAdvanceLevel).b;
    console.log(
      `  WRAP ${label}: BOARD=${hx(post.mem.read8(BOARD))} SEQPTR=${hx(post.mem.read16(BOARD_SEQ_PTR))} ` +
        `LEVEL=${hx(post.mem.read8(LEVEL))} SUBSTATE=${hx(post.mem.read8(GAME_SUBSTATE))} (${stackDiffs} stack bytes excluded)`,
    );
  }
});

// -- 5. NO STACK MODELLING ----------------------------------------------------

test("NO STACK MODELLING: runRivetBoardFinaleThenAdvanceLevel leaves SP and pc at entry on every arm", () => {
  const entries = [
    ["gate-ret", craftBase({ ...SWEEP_BASE, counter: 0x00 })],
    ["proceed", craftBase({ ...SWEEP_BASE, counter: 0x09 })],
    ["stage", craftBase({ ...SWEEP_BASE, counter: 0xe1 })],
    ["record", craftBase({ ...SWEEP_BASE, counter: 0xc1 })],
    ["wrap", craftBase({ ...SWEEP_BASE, counter: 0x01 })],
  ];
  for (const [label, entry] of entries) {
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    runRivetBoardFinaleThenAdvanceLevel(b);
    assert.equal(b.regs.sp, sp0, `${label}: runRivetBoardFinaleThenAdvanceLevel must leave SP unchanged (no stack modelling)`);
    assert.equal(b.pc, pc0, `${label}: runRivetBoardFinaleThenAdvanceLevel must leave pc unchanged (no ret modelling)`);
  }
  console.log("  NO STACK MODELLING: SP/pc unchanged on gate-ret / proceed / stage / record / wrap");
});

// -- 6. TEETH -----------------------------------------------------------------

/**
 * Broken twin: the every-8th gate masks 0x0F instead of 0x07. It agrees with the
 * oracle on 240/256 counter values, diverging only on multiples of 8 that are not
 * multiples of 16 (the routine then wrongly skips the proceed step), so only a real
 * counter sweep catches it. Everything else mirrors runRivetBoardFinaleThenAdvanceLevel exactly, so the sole
 * divergence is the gate.
 */
function brokenLoc18c6(m) {
  const { mem, regs } = m;
  const counter = (mem.read8(PACE_COUNTER) - 1) & 0xff;
  mem.write8(PACE_COUNTER, counter);
  if (counter === 0) {
    let ptr = (mem.read16(BOARD_SEQ_PTR) + 1) & 0xffff;
    let nextBoard = mem.read8(ptr);
    if (nextBoard === 0x7f) { ptr = 0x3a73; nextBoard = mem.read8(ptr); }
    mem.write16(BOARD_SEQ_PTR, ptr);
    mem.write8(BOARD, nextBoard);
    mem.write8(LEVEL, (mem.read8(LEVEL) + 1) & 0xff);
    regs.de = 0x0500;
    enqueueTask(m);
    mem.write8(0x622e, 0x00);
    mem.write8(0x6388, 0x00);
    mem.write8(0x6009, 0xe0);
    mem.write8(GAME_SUBSTATE, 0x08);
    return;
  }
  if ((counter & 0x0f) !== 0) return; // BUG: 0x0F should be 0x07
  mem.write8(0x6a25, mem.read8(0x6a25) ^ 0x80);
  const sel = nextAnimationStep(0x00, mem.read8(BLINK_6919) & 0xdf);
  mem.write8(BLINK_6919, (sel.a | 0x20) & 0xff);
  if (counter === 0xe0) {
    mem.write8(0x694f, 0x50);
    if (mem.read8(MARIO_X) < 0x80) { mem.write8(0x694d, 0x80); mem.write8(0x694c, 0x5f); }
    else { mem.write8(0x694d, 0x00); mem.write8(0x694c, 0x9f); }
    return;
  }
  if (counter !== 0xc0) return;
  mem.write8(0x608a, mem.read8(LEVEL) & 0x01 ? 0x0c : 0x05);
  mem.write8(0x608b, 0x03);
  mem.write8(0x6a20, 0x8f); mem.write8(0x6a21, 0x76); mem.write8(0x6a22, 0x09); mem.write8(0x6a23, 0x40);
  if (mem.read8(MARIO_X) < 0x80) mem.write8(0x6a20, 0x6f);
}

test("TEETH: the wrong gate-mask twin (0x0F for 0x07) is CAUGHT by the counter sweep", () => {
  const sbase = craftBase(SWEEP_BASE);
  let caught = null;
  for (let v = 0; v < 256 && !caught; v++) {
    const a = sbase.clone(); const b = sbase.clone();
    a.mem.write8(PACE_COUNTER, v);
    b.mem.write8(PACE_COUNTER, v);
    oracle(a);
    brokenLoc18c6(b);
    const { bad } = ramDiffMinusStack(a, b, sbase.regs.sp);
    if (bad) caught = { v, bad };
  }
  assert.notEqual(caught, null, "the counter sweep FAILED to catch a wrong every-8th gate mask — it is worthless");
  console.log(
    `  TEETH: caught at 0x62AF=${hx(caught.v)} — RAM diff at ${hx(caught.bad.addr)} ` +
      `(oracle=${caught.bad.a} broken=${caught.bad.b})`,
  );
});
