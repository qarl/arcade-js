// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for commitGameStart (ROM 0x08F8) — commit a credited game start.
 *
 * commitGameStart WRITES a lot of memory (CREDITS via spendCredit, the task ring via
 * enqueueTask, both player context records, the tilemap + sprite buffer via
 * clearPlayfieldAndSprites, TWO_PLAYER_GAME, GAME_SUBSTATE, GAME_STATE) and is deep in
 * a call cascade, so it is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH
 * clone per case. Because it under-charges cycles (no m.step), the strict whole-machine
 * byte-exact gate does not apply; the contract is RAM (minus the stack scratch below the entry SP) + candidate
 * SP/pc unchanged, exactly the memory-equivalence contract.
 *
 *   1. REALISM (real captured dispatches) — a coin+start1 tape drives the credited state.
 *      commitGameStart is dispatched every credited frame: ~33 times on the NEITHER arm
 *      (no start pressed -> do nothing) and once on the real 1-PLAYER start (CREDITS==1
 *      -> A=0x04). Replay the ORACLE on one clone and commitGameStart on another and
 *      confirm every game-visible byte matches; the only tolerated residue is
 *      STACK_SCRATCH (the oracle models push/call/ret, commitGameStart uses the JS call
 *      stack). commitGameStart must leave SP and pc at their entry values.
 *
 *   2. CRAFTED (2-PLAYER arm) — attract/one-coin never presses START2 with >1 credit, so
 *      the 2-player arm is forced from a real credited entry: poke CREDITS=2 (so the
 *      selector allows START2), FRAME to a non-draw frame, and assert IN2's START2 bit,
 *      identically on both sides. Confirms the two-credit spend, the P2 context seed, the
 *      player-2 task, and TWO_PLAYER_GAME=1.
 *
 *   3. CRAFTED (both-buttons NEITHER arm) — A==0x0C (START1|START2 both held) must do
 *      NOTHING. Forced the same way with both start bits asserted; RAM stays identical to
 *      the oracle and unchanged from entry.
 *
 *   4. TEETH — two broken twins the gates MUST catch:
 *        A. drops the 1P/2P distinction (TWO_PLAYER_GAME always 0) — invisible on the 1P
 *           and NEITHER arms, caught ONLY by the crafted 2-PLAYER arm (proves that
 *           coverage is load-bearing).
 *        B. fails to advance the game (GAME_STATE := 2 instead of 3) — the routine's whole
 *           point; caught by the real 1-PLAYER dispatch (proves the realism gate has teeth).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-08f8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_08f8 as oracle } from "../../translated/loc_08f8.js";
import { commitGameStart } from "../commitGameStart.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { readStartButtonSelector } from "../readStartButtonSelector.js";
import { spendCredit } from "../spendCredit.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { enqueueTask } from "../enqueueTask.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x08f8;
const CREDITS = 0x6001;
const FRAME = 0x601a;
const GAME_STATE = 0x6005;
const GAME_SUBSTATE = 0x600a;
const TWO_PLAYER_GAME = 0x600f;
const P1_CONTEXT = 0x6040;
const P2_CONTEXT = 0x6048;
const DIP_LIVES = 0x6020;
const CONTEXT_TEMPLATE = 0x095e;
const IN2 = 0x7d00;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inStack = (a) => a >= STACK_SCRATCH.lo && a < STACK_SCRATCH.hi;

// A coin then a 1-player start. Coin (IN2 bit7) at frame 10 credits the machine so
// GAME_STATE reaches 2; start1 (IN2 bit2) at frame 45 makes commitGameStart accept the
// 1-player start (CREDITS==1 -> selector 0x04). dur 6 = MAME's coin/button hold.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 10, dur: 6 }, // coin1
  { port: 0x7d00, bits: 0x04, frame: 45, dur: 6 }, // start1
];

/**
 * First differing RAM byte between two machines, EXCLUDING the dead stack-scratch
 * region (the memory-equivalence contract is RAM − the stack scratch below the entry SP). A null diff also
 * PROVES stack confinement: any oracle push that underflowed below STACK_SCRATCH into
 * real RAM would surface here (commitGameStart writes no stack bytes at all).
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

/** Replay one entry through the oracle and a candidate on independent FRESH clones
 *  (the routine writes RAM), returning the game-visible diff. */
function replay(entry, candidate) {
  const a = entry.clone();
  const b = entry.clone();
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/** Drive coin+start and clone the machine at each real 0x08F8 dispatch. The wrapper
 *  delegates to the oracle so the host run proceeds to a clean stop. */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  host.runFrames(maxFrames);
  return caps;
}

/** Classify what arm the oracle takes on an entry (by its GAME_STATE / TWO_PLAYER result). */
function classify(entry) {
  const a = entry.clone();
  const gs0 = a.mem.read8(GAME_STATE);
  oracle(a);
  const gs1 = a.mem.read8(GAME_STATE), tp1 = a.mem.read8(TWO_PLAYER_GAME);
  if (gs1 === gs0 && gs1 === 2) return "neither";
  if (gs1 === 3 && tp1 === 0) return "1P";
  if (gs1 === 3 && tp1 === 1) return "2P";
  return "?";
}

/** Poke a real credited entry into the 2-PLAYER (bits=0x08) or both-buttons (bits=0x0C)
 *  arm: CREDITS=2 so the selector allows START2, FRAME to a non-draw frame, and the
 *  requested IN2 start bits asserted. Applied identically to the given clone. */
function forceStart(clone, bits) {
  clone.mem.write8(CREDITS, 0x02);
  clone.mem.write8(FRAME, 0x01); // (1 & 7) != 0 -> readStartButtonSelector skips the draw
  clone.io.inputAssert = { [IN2]: bits };
}

// -- 1. REALISM (real captured dispatches) ------------------------------------

test("REALISM: real 0x08F8 dispatches (NEITHER + 1-PLAYER) — game-visible RAM identical", () => {
  const caps = captureDispatches(64, 150);
  assert.ok(caps.length >= 2, "expected several real 0x08F8 dispatches after coin+start");

  let neither = 0, onePlayer = 0;
  for (const entry of caps) {
    const arm = classify(entry);
    if (arm === "neither") neither++;
    if (arm === "1P") onePlayer++;

    const { bad, a: oc } = replay(entry, commitGameStart);
    assert.equal(
      bad,
      null,
      bad && `[${arm}] game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on CREDITS=${hx(entry.mem.read8(CREDITS))} FRAME=${hx(entry.mem.read8(FRAME))}`,
    );
    void oc;

    // Entry SP must sit inside STACK_SCRATCH so the oracle's push/call/ret stay in the
    // dead region (the null diff above already proves nothing underflowed into real RAM).
    assert.ok(
      inStack(entry.regs.sp),
      `oracle's stack must live in STACK_SCRATCH (entry SP=${hx(entry.regs.sp)})`,
    );

    // commitGameStart must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    commitGameStart(b);
    assert.equal(b.regs.sp, sp0, "commitGameStart must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "commitGameStart must leave pc unchanged (no ret modelling)");
  }
  assert.ok(onePlayer >= 1, "expected the real 1-PLAYER start dispatch");
  assert.ok(neither >= 1, "expected credited-wait (NEITHER) dispatches");
  console.log(`  REALISM: ${caps.length} real dispatches (${neither} NEITHER, ${onePlayer} 1-PLAYER) — game-visible RAM identical`);
});

// -- 2. CRAFTED (2-PLAYER arm) ------------------------------------------------

test("CRAFTED: forced 2-PLAYER start — two credits spent, P2 seeded, TWO_PLAYER_GAME=1", () => {
  const caps = captureDispatches(64, 150);
  const base = caps.find((e) => classify(e) === "neither");
  assert.ok(base, "expected a real credited-wait entry to craft the 2-PLAYER arm from");

  const a = base.clone(); const b = base.clone();
  forceStart(a, 0x08); forceStart(b, 0x08); // START2 only
  oracle(a);
  commitGameStart(b);
  const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
  assert.equal(
    bad,
    null,
    bad && `2-PLAYER: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
  );
  // Sanity: the oracle really took the 2-PLAYER arm.
  assert.equal(a.mem.read8(GAME_STATE), 3, "expected GAME_STATE advanced to 3");
  assert.equal(a.mem.read8(TWO_PLAYER_GAME), 1, "expected TWO_PLAYER_GAME=1 on the 2-PLAYER arm");
  assert.equal(a.mem.read8(CREDITS), 0, "expected two credits spent (2 -> 0)");
  console.log(`  CRAFTED 2-PLAYER: GAME_STATE->3, TWO_PLAYER_GAME=1, CREDITS 2->0, P2 seeded — RAM identical`);
});

// -- 3. CRAFTED (both-buttons NEITHER arm) ------------------------------------

test("CRAFTED: both start buttons held (A==0x0C) — do NOTHING, RAM identical & unchanged", () => {
  const caps = captureDispatches(64, 150);
  const base = caps.find((e) => classify(e) === "neither");
  assert.ok(base, "expected a real credited-wait entry to craft the both-buttons arm from");

  const a = base.clone(); const b = base.clone();
  forceStart(a, 0x0c); forceStart(b, 0x0c); // START1 | START2
  const gsBefore = b.mem.read8(GAME_STATE);
  const before = b.dumpState().slice();
  oracle(a);
  commitGameStart(b);
  const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
  assert.equal(bad, null, bad && `both-buttons: RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`);
  // It must genuinely do nothing: GAME_STATE stays credited and RAM is untouched.
  assert.equal(b.mem.read8(GAME_STATE), gsBefore, "both-buttons arm must not advance GAME_STATE");
  const after = b.dumpState();
  let changed = null;
  for (let i = 0; i < after.length && !changed; i++) if (after[i] !== before[i]) changed = b.stateOffsetToAddr(i);
  assert.equal(changed, null, changed && `both-buttons arm wrote RAM at ${hx(changed)} — it must do nothing`);
  console.log(`  CRAFTED both-buttons: no arm taken, RAM identical to the oracle and unchanged from entry`);
});

// -- 4. TEETH -----------------------------------------------------------------

// A local copy of commitGameStart's context seed, so the twins below differ from the
// real routine in EXACTLY one line (the injected bug), nothing else.
function seedCtx(m, base) {
  const { mem } = m;
  mem.write8(base, mem.read8(DIP_LIVES));
  for (let i = 0; i < 7; i++) mem.write8(base + 1 + i, mem.read8(CONTEXT_TEMPLATE + i));
}

/** Twin A: drops the 1P/2P distinction — always writes TWO_PLAYER_GAME=0. Identical to
 *  the oracle on the 1P and NEITHER arms; only the 2-PLAYER arm can catch it. */
function brokenDropTwoPlayer(m) {
  const { regs, mem } = m;
  readStartButtonSelector(m);
  const sel = regs.a;
  if (sel === 0x04) {
    spendCredit(m);
    for (let i = 0; i < 8; i++) mem.write8(P2_CONTEXT + i, 0x00);
  } else if (sel === 0x08) {
    spendCredit(m); spendCredit(m);
    seedCtx(m, P2_CONTEXT);
    regs.de = 0x0101; enqueueTask(m);
  } else return;
  mem.write8(0x600e, 0x00);
  mem.write8(TWO_PLAYER_GAME, 0x00); // BUG: should be 1 on the 2-PLAYER arm
  clearPlayfieldAndSprites(m);
  seedCtx(m, P1_CONTEXT);
  regs.de = 0x0100; enqueueTask(m);
  mem.write8(GAME_SUBSTATE, 0x00);
  mem.write8(GAME_STATE, 0x03);
}

/** Twin B: fails to advance the game — writes GAME_STATE=2 instead of 3. Any real start
 *  dispatch catches it. */
function brokenNoAdvance(m) {
  const { regs, mem } = m;
  readStartButtonSelector(m);
  const sel = regs.a;
  if (sel === 0x04) {
    spendCredit(m);
    for (let i = 0; i < 8; i++) mem.write8(P2_CONTEXT + i, 0x00);
  } else if (sel === 0x08) {
    spendCredit(m); spendCredit(m);
    seedCtx(m, P2_CONTEXT);
    regs.de = 0x0101; enqueueTask(m);
  } else return;
  mem.write8(0x600e, 0x00);
  mem.write8(TWO_PLAYER_GAME, sel === 0x08 ? 0x01 : 0x00);
  clearPlayfieldAndSprites(m);
  seedCtx(m, P1_CONTEXT);
  regs.de = 0x0100; enqueueTask(m);
  mem.write8(GAME_SUBSTATE, 0x00);
  mem.write8(GAME_STATE, 0x02); // BUG: should be 3 (advance into gameplay)
}

test("TEETH A: the drop-2P-flag twin is CAUGHT by the crafted 2-PLAYER arm (at 0x600F)", () => {
  const caps = captureDispatches(64, 150);
  const base = caps.find((e) => classify(e) === "neither");
  assert.ok(base, "expected a credited-wait entry");

  const a = base.clone(); const b = base.clone();
  forceStart(a, 0x08); forceStart(b, 0x08);
  oracle(a);
  brokenDropTwoPlayer(b);
  const { bad } = ramDiffMinusStack(a, b, base.regs.sp);
  assert.notEqual(bad, null, "the 2-PLAYER arm FAILED to catch a dropped TWO_PLAYER_GAME flag — it is worthless");
  assert.equal(bad.addr, TWO_PLAYER_GAME, `expected the caught diff at 0x600F, got ${hx(bad.addr)}`);
  console.log(`  TEETH A: caught at 0x600F (oracle=${bad.a} broken=${bad.b})`);
});

test("TEETH B: the no-advance twin is CAUGHT by the real 1-PLAYER dispatch (at 0x6005)", () => {
  const caps = captureDispatches(64, 150);
  const start = caps.find((e) => classify(e) === "1P");
  assert.ok(start, "expected a real 1-PLAYER start dispatch");

  const a = start.clone(); const b = start.clone();
  oracle(a);
  brokenNoAdvance(b);
  const { bad } = ramDiffMinusStack(a, b, start.regs.sp);
  assert.notEqual(bad, null, "the realism gate FAILED to catch an unadvanced GAME_STATE — it is worthless");
  assert.equal(bad.addr, GAME_STATE, `expected the caught diff at 0x6005, got ${hx(bad.addr)}`);
  console.log(`  TEETH B: caught at 0x6005 (oracle=${bad.a} broken=${bad.b})`);
});
