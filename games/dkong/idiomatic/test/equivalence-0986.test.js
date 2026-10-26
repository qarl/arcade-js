// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for configureFlipScreenAndSelectSubstate (ROM 0x0986) — the
 * first in-game NMI's start-up step: clear the screen + sound (call 0x0852, call
 * 0x011c), set the flip-screen latch 0x7D82 for the cabinet, and store the next
 * GAME_SUBSTATE (0x600A) — 1 for a 1-player start, 3 for a 2-player start.
 *
 * loc_0986 WRITES memory (the callees' tilemap/sprite/sound-shadow spans + a store
 * to GAME_SUBSTATE) and the flip-screen board latch, and READS only two selector
 * bytes (0x600E join-low, 0x6026 DIP_UPRIGHT). So it is validated by
 * capture/clone/replay on a FRESH clone per case — never reusing one machine, never
 * the full register file, never cycles. The compared contract is:
 *
 *   RAM (minus the stack scratch below the entry SP)  +  io.flipScreen (the 0x7D82 latch)
 *
 * The flip-screen latch is a board io output, NOT in the RAM dump — and the upright
 * (flip ON) and cocktail (flip OFF) 2-player arms BOTH store GAME_SUBSTATE=3, so
 * they differ ONLY in that latch. Comparing io.flipScreen is therefore load-bearing:
 * without it the cocktail path would be unverified. No live-out registers/flags (the
 * rst-0x28 sub-state dispatch consumes none); SP/PC are not compared — the idiomatic
 * layer drops the oracle's `ret` stack/PC bookkeeping (JS call stack).
 *
 *   1. REALISM — a coin+start tape drives GAME_STATE to 3; loc_0986 dispatches ONCE
 *      (frame ~152, the 1-player / 0x600E==0 arm). Run oracle vs candidate on two
 *      fresh clones of the real entry and confirm identical RAM (ex-stack) + flip.
 *
 *   2. CRAFTED (branch coverage) — the natural run only hits the 1-player arm, so
 *      the two 2-player arms are forced from the SAME captured entry by poking
 *      0x600E/0x6026 identically on both sides (the callees never touch either
 *      byte). Every arm's RAM + flip is compared to the oracle, AND the oracle's own
 *      (substate, flip) outcome is asserted so the arm cannot pass vacuously.
 *
 *   3. TEETH — three deliberately-broken twins MUST be caught: (a) a wrong
 *      GAME_SUBSTATE store (RAM diff at 0x600A); (b) a SKIPPED cocktail flip-clear
 *      that leaves flip ON (io.flipScreen diff — the check the RAM gate is blind to);
 *      (c) a SKIPPED silenceSound (RAM diff in the sound shadow 0x6080..).
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0986.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0986 as oracle } from "../../translated/loc_0986.js";
import { configureFlipScreenAndSelectSubstate as candidate } from "../configureFlipScreenAndSelectSubstate.js";
// The teeth twins reuse the real idiomatic callees so only the injected defect differs.
import { clearTilemapAndSprites as clearTilemapAndSpritesLike } from "../clearTilemapAndSprites.js";
import { silenceSound as silenceSoundLike } from "../silenceSound.js";
import { Machine } from "../../machine.js";
import { GAME_SUBSTATE, DIP_UPRIGHT, SND_TRIGGER, STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0986;
const JOIN_VALUE_LO = 0x600e;
const FLIPSCREEN = 0x7d82;
const FRAMES = 160; // loc_0986 dispatches once, ~frame 152 (the 1-player start)

// Canonical coin+start tape (same contract as the optimized 0x0986 gate): pulse the
// IN2 coin bit (0x80) then the start1 bit (0x04) so the ROM's own credit/start logic
// starts a 1-player game and the state-3 dispatcher reaches loc_0986.
const COIN_START_TAPE = [
  { port: 0x7d00, bits: 0x80, frame: 90, dur: 6 }, // coin
  { port: 0x7d00, bits: 0x04, frame: 150, dur: 6 }, // start1
];

const makeMachine = (overrides) => {
  const m = new Machine(ROM, overrides ? { overrides } : {});
  m.inputTape = COIN_START_TAPE.map((t) => ({ ...t }));
  return m;
};

const hx = (v) => "0x" + (v & 0xffff).toString(16);

// -- comparison plumbing ------------------------------------------------------

/**
 * First observable difference between two machines after each has run its routine:
 * a RAM byte (skipping the stack scratch below the entry SP) OR the flip-screen board latch
 * (io.flipScreen — the 0x7D82 output, which is NOT in the RAM dump). Returns null if
 * identical. RAM is checked first, then the latch.
 */
function firstDiffOutsideStack(a, b, liveFloor) {
  const dead = deadStackBelow(STACK_SCRATCH, liveFloor);
  const da = a.dumpState();
  const db = b.dumpState();
  const n = Math.min(da.length, db.length);
  for (let i = 0; i < n; i++) {
    if (da[i] === db[i]) continue;
    const addr = a.stateOffsetToAddr(i);
    if (dead(addr)) continue;
    return { kind: "ram", addr, a: da[i], b: db[i] };
  }
  if (a.io.flipScreen !== b.io.flipScreen) {
    return { kind: "flip", addr: FLIPSCREEN, a: a.io.flipScreen, b: b.io.flipScreen };
  }
  return null;
}

const fmt = (d) =>
  d && (d.kind === "flip"
    ? `flip-screen(${hx(d.addr)}) oracle=${d.a} cand=${d.b}`
    : `RAM ${hx(d.addr)} oracle=${d.a} cand=${d.b}`);

/** Run the oracle and `cand` on two FRESH clones of `entry` and diff (ex-stack + flip). */
function diffAgainstOracle(entry, cand) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  cand(b);
  return firstDiffOutsideStack(a, b, entry.regs.sp);
}

// -- entry capture (the real 1-player dispatch, and the crafted base) ----------

/**
 * Capture the machine at the instant loc_0986 is FIRST entered (frame ~152, the
 * 1-player / 0x600E==0 arm) and return that pristine clone. The wrapper clones the
 * entry state, then runs the ORACLE so the host game proceeds undisturbed.
 */
function captureEntry() {
  let entry = null;
  const snap = new Map([[TARGET, (mm) => {
    if (entry === null) entry = mm.clone();
    return oracle(mm);
  }]]);
  makeMachine(snap).runFrames(FRAMES);
  return entry;
}

const ENTRY = ROM_PRESENT ? captureEntry() : null;

/** Clone the captured entry and force one branch by poking the two selector bytes. */
function craftArm(v600e, v6026) {
  const w = ENTRY.clone();
  w.mem.write8(JOIN_VALUE_LO, v600e);
  w.mem.write8(DIP_UPRIGHT, v6026);
  return w;
}

// -- 1. REALISM (captured dispatch) -------------------------------------------

test("REALISM: the real 1-player 0x0986 dispatch — RAM (ex-stack) + flip match the oracle", () => {
  assert.ok(ENTRY, "loc_0986 never dispatched within the coin+start window — reachability broke");

  // Document where it fired: state 3, sub-state 0, and the 1-player join byte.
  assert.equal(ENTRY.mem.read8(0x6005), 3, "0x0986 is reached with GAME_STATE(0x6005)==3 (in game)");
  assert.equal(ENTRY.mem.read8(GAME_SUBSTATE), 0, "0x0986 is table arm 0 → GAME_SUBSTATE==0 at entry");
  assert.equal(ENTRY.mem.read8(JOIN_VALUE_LO), 0, "the natural start is 1-player (0x600E==0)");

  const d = diffAgainstOracle(ENTRY, candidate);
  assert.equal(d, null, d && `divergence: ${fmt(d)}`);

  // Confirm the outcome the oracle produced on this real entry, so REALISM is not vacuous.
  const o = ENTRY.clone();
  oracle(o);
  assert.equal(o.mem.read8(GAME_SUBSTATE), 1, "1-player start selects sub-state 1");
  assert.equal(o.io.flipScreen, 1, "1-player start leaves flip-screen ON");
  console.log("  REALISM: real 1-player dispatch — RAM (ex-stack) + flip identical; substate→1, flip ON");
});

// -- 2. CRAFTED (branch coverage) ---------------------------------------------

test("CRAFTED: all three arms (1P / 2P upright / 2P cocktail) match the oracle in RAM + flip", () => {
  assert.ok(ENTRY, "need the captured entry to craft branch arms from");

  const arms = [
    { v600e: 0x00, v6026: 0x01, label: "1-player (600E=0)", sub: 1, flip: 1 },
    { v600e: 0x01, v6026: 0x01, label: "2-player upright (600E!=0, 6026==1)", sub: 3, flip: 1 },
    { v600e: 0x01, v6026: 0x00, label: "2-player cocktail (600E!=0, 6026!=1)", sub: 3, flip: 0 },
    { v600e: 0x80, v6026: 0x02, label: "2-player cocktail, join hi + DIP=2", sub: 3, flip: 0 },
  ];

  for (const arm of arms) {
    const w = craftArm(arm.v600e, arm.v6026);

    // Candidate reproduces the oracle exactly (RAM ex-stack + flip).
    const d = diffAgainstOracle(w, candidate);
    assert.equal(d, null, d && `arm ${arm.label}: ${fmt(d)}`);

    // And the oracle actually took the branch we think (guards against a vacuous pass).
    const o = w.clone();
    oracle(o);
    assert.equal(o.mem.read8(GAME_SUBSTATE), arm.sub, `arm ${arm.label}: oracle substate`);
    assert.equal(o.io.flipScreen, arm.flip, `arm ${arm.label}: oracle flip-screen`);
  }
  console.log(`  CRAFTED: ${arms.length} arms — RAM (ex-stack) + flip identical; substate 1/3 & flip ON/OFF pinned`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Twin (a): stores the WRONG GAME_SUBSTATE (adds 1) — a RAM diff at 0x600A. */
function brokenSubstate(m) {
  const { mem } = m;
  clearTilemapAndSpritesLike(m);
  silenceSoundLike(m);
  mem.write8(FLIPSCREEN, 1);
  if (mem.read8(JOIN_VALUE_LO) === 0) {
    mem.write8(GAME_SUBSTATE, 0x02); // BUG: 1-player should store 1
    return;
  }
  if (mem.read8(DIP_UPRIGHT) !== 1) mem.write8(FLIPSCREEN, 0);
  mem.write8(GAME_SUBSTATE, 0x04); // BUG: 2-player should store 3
}

/** Twin (b): SKIPS the cocktail flip-clear (leaves flip ON) — an io.flipScreen diff. */
function brokenNoFlipClear(m) {
  const { mem } = m;
  clearTilemapAndSpritesLike(m);
  silenceSoundLike(m);
  mem.write8(FLIPSCREEN, 1);
  if (mem.read8(JOIN_VALUE_LO) === 0) {
    mem.write8(GAME_SUBSTATE, 0x01);
    return;
  }
  // BUG: dropped the `if (DIP_UPRIGHT != 1) flip = 0` cocktail clear.
  mem.write8(GAME_SUBSTATE, 0x03);
}

/** Twin (c): SKIPS silenceSound — a RAM diff in the sound-trigger shadow (0x6080..). */
function brokenNoSilence(m) {
  const { mem } = m;
  clearTilemapAndSpritesLike(m);
  // BUG: silenceSound call dropped.
  mem.write8(FLIPSCREEN, 1);
  if (mem.read8(JOIN_VALUE_LO) === 0) {
    mem.write8(GAME_SUBSTATE, 0x01);
    return;
  }
  if (mem.read8(DIP_UPRIGHT) !== 1) mem.write8(FLIPSCREEN, 0);
  mem.write8(GAME_SUBSTATE, 0x03);
}

test("TEETH: wrong-substate, skipped-flip-clear, and skipped-sound twins are all CAUGHT", () => {
  assert.ok(ENTRY, "need the captured entry for the teeth");

  // (a) wrong substate — on the 1-player arm, caught at GAME_SUBSTATE.
  const eSub = craftArm(0x00, 0x01);
  const dSub = diffAgainstOracle(eSub, brokenSubstate);
  assert.notEqual(dSub, null, "the gate FAILED to catch a wrong GAME_SUBSTATE store — it is worthless");
  assert.equal(dSub.kind, "ram", "wrong-substate must be caught as a RAM diff");
  assert.equal(dSub.addr, GAME_SUBSTATE, "wrong-substate must diverge at GAME_SUBSTATE (0x600A)");
  assert.equal(dSub.a, 0x01, "oracle stores 1 (1-player)");
  assert.equal(dSub.b, 0x02, "broken twin stores 2");

  // (b) skipped cocktail flip-clear — RAM is identical (both store substate 3); the
  //     ONLY tell is io.flipScreen. This is the check the RAM gate cannot make.
  const eFlip = craftArm(0x01, 0x00); // cocktail: oracle clears flip to 0
  const dFlip = diffAgainstOracle(eFlip, brokenNoFlipClear);
  assert.notEqual(dFlip, null, "the gate FAILED to catch a skipped flip-screen clear — it is worthless");
  assert.equal(dFlip.kind, "flip", "skipped flip-clear must be caught via io.flipScreen, not RAM");
  assert.equal(dFlip.a, 0, "oracle clears flip-screen on cocktail");
  assert.equal(dFlip.b, 1, "broken twin leaves flip-screen ON");

  // (c) skipped silenceSound — the captured entry's sound shadow is already zero, so
  //     a dropped zero-write would be invisible; pre-dirty 0x6080-0x608B to a sentinel
  //     (identically on both sides) so the oracle clears it and the broken twin leaves
  //     the sentinel. Only silenceSound touches that span, so the diff is unambiguous.
  const eSnd = craftArm(0x00, 0x01);
  for (let a = 0x6080; a <= 0x608b; a++) eSnd.mem.write8(a, 0xaa);
  const dSnd = diffAgainstOracle(eSnd, brokenNoSilence);
  assert.notEqual(dSnd, null, "the gate FAILED to catch a skipped sound-clear — it is worthless");
  assert.equal(dSnd.kind, "ram", "skipped sound-clear must be caught as a RAM diff");
  assert.ok(
    dSnd.addr >= SND_TRIGGER && dSnd.addr <= 0x608b,
    `skipped-sound diff must land in the sound shadow (0x6080-0x608B), got ${hx(dSnd.addr)}`,
  );

  console.log(
    `  TEETH: wrong-substate caught at ${hx(dSub.addr)} (${dSub.a}->${dSub.b}); ` +
      `skipped-flip caught via flip-screen (${dFlip.a}->${dFlip.b}); ` +
      `skipped-sound caught at ${hx(dSnd.addr)}`,
  );
});
