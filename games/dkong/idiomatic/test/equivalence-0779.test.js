// SPDX-License-Identifier: GPL-3.0-only
/**
 * Equivalence test for composeAttractTitleScreen (ROM 0x0779) — the attract
 * title/score-screen composer (GAME_STATE 1, sub-state 0).
 *
 * The routine WRITES a lot of memory (task ring, sub-state timer/index, playfield +
 * sprite buffer, score labels, coinage digits) and calls six sub-routines, so it is NOT
 * a pure leaf. It is gated by capture / clone / replay (docs/decompiler-pipeline) with a FRESH clone per
 * case (it mutates RAM), never the exhaustive-leaf pattern. The diff is whole-RAM minus
 * STACK_SCRATCH: the oracle models each call's push/ret stack traffic (its SP/pc move)
 * while the idiomatic routine uses the JS call stack and models neither, so the only
 * tolerated residue is the pushed bytes in the dead stack scratch.
 *
 *   1. EQUAL (real captured dispatches) — hook 0x0779 in a real attract run and clone
 *      the machine at each true dispatch (~4 per long run, as the title screen is
 *      composed). For each: run the ORACLE on one clone and composeAttractTitleScreen on
 *      another; game-visible RAM must be identical (diff confined to STACK_SCRATCH). Also
 *      assert the idiomatic routine leaves SP and pc UNCHANGED (no stack/ret modelling).
 *      Attract is always 1-player with 2P-coins == 2, so this covers the 1P path only.
 *
 *   2. EQUAL (crafted arms) — the arms attract never reaches, forced by poking ONE byte
 *      IDENTICALLY on both sides of a real entry (docs/decompiler-pipeline crafted entry):
 *        - TWO_PLAYER (0x600F = 1): the `cp 1 / call z` arm fires draw2UpLabel (the 2UP
 *          label at 0x74A0/0x74C0/0x74E0).
 *        - TENS_CARRY (0x6023 = 10): the first digit-writer pass hits the D==10 split,
 *          stamping a ones 0 at 0x756E and a tens 1 in the carry cell 0x758E.
 *        - FULL_RING (ring all occupied): every one of the nine task posts is dropped and
 *          TASK_TAIL is left untouched.
 *      Plus a positive CLEAN-ring content check that pins the exact task payload this
 *      handler lays down and the 0xC0 -> 0xD2 tail advance (9 messages x 2 bytes).
 *
 *   3. TEETH — a twin that DROPS the second title-string post (arg 0x1C) — a plausible
 *      off-by-one in the direct posts. It writes one fewer ring slot and advances the
 *      tail two short, so it MUST be caught both on captured dispatches and on a
 *      deterministic clean-ring entry. A gate a real corruption slips through is worthless.
 *
 * Run: node --test games/dkong/idiomatic/test/equivalence-0779.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0779 as oracle } from "../../translated/loc_0779.js";
import { composeAttractTitleScreen } from "../composeAttractTitleScreen.js";
import { enqueueTask } from "../enqueueTask.js";
import { enqueueTaskBatch } from "../enqueueTaskBatch.js";
import { clearPlayfieldAndSprites } from "../clearPlayfieldAndSprites.js";
import { draw1UpLabel } from "../draw1UpLabel.js";
import { draw2UpLabel } from "../draw2UpLabel.js";
import { writeDigitPairWithCarry } from "../writeDigitPairWithCarry.js";
import { Machine } from "../../machine.js";
import { STACK_SCRATCH } from "../names.js";
import { deadStackBelow } from "../../../../core/equivalence.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/dkong rom'" }, fn);

const TARGET = 0x0779;
const TASK_TAIL = 0x60b0;
const RING_LO = 0x60c0, RING_HI = 0x60ff; // 32 slots x 2 bytes
const TWO_PLAYER_GAME = 0x600f;
const DIP_COINS_FOR_2P = 0x6023;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

/**
 * Diff two machines' RAM. Returns the first difference OUTSIDE the stack scratch below the entry SP
 * (game-visible — a real failure) or null, plus how many bytes differed inside the
 * dead stack scratch (the tolerated push residue).
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

/** Replay one entry state through the oracle and a candidate on independent clones. */
function replay(entry, candidate) {
  const a = entry.clone(); // oracle
  const b = entry.clone(); // candidate
  oracle(a);
  candidate(b);
  return { a, b, ...ramDiffMinusStack(a, b, entry.regs.sp) };
}

/**
 * Hook 0x0779 in a real attract run and clone the machine at up to K true dispatches.
 * handler_0779 is the attract sub-state-0 handler, so it fires whenever the attract
 * loop composes the title screen; the wrapper delegates to the oracle so the host run
 * proceeds undisturbed.
 */
function captureDispatches(K, maxFrames) {
  const caps = [];
  const snapshot = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snapshot });
  host.runFrames(maxFrames);
  return caps;
}

// Poke a whole ring state (fill + tail) IDENTICALLY on a real entry — a surgical
// crafted nudge (docs/decompiler-pipeline), not a fabrication.
const fillRing = (m, byte) => { for (let s = RING_LO; s <= RING_HI; s++) m.mem.write8(s, byte); };
const CLEAN = (m) => { fillRing(m, 0xff); m.mem.write8(TASK_TAIL, 0xc0); }; // all free, base
const FULL  = (m) => { fillRing(m, 0x00); m.mem.write8(TASK_TAIL, 0xc0); }; // all occupied

// -- 1. EQUAL (real captured dispatches) --------------------------------------

test("EQUAL (captured): composeAttractTitleScreen == oracle on every real attract dispatch (diff confined to stack)", () => {
  const caps = captureDispatches(64, 9000);
  assert.ok(caps.length >= 1, "expected at least one real 0x0779 dispatch during attract");

  for (const entry of caps) {
    // The oracle's push traffic must land in dead stack scratch, so excluding
    // STACK_SCRATCH cannot mask a real diff — the entry SP sits inside the region.
    assert.ok(
      entry.regs.sp > STACK_SCRATCH.lo && entry.regs.sp <= STACK_SCRATCH.hi,
      `entry SP must sit inside STACK_SCRATCH so oracle pushes stay in-region (SP=${hx(entry.regs.sp)})`,
    );

    const { bad } = replay(entry, composeAttractTitleScreen);
    assert.equal(
      bad,
      null,
      bad && `game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b}) ` +
        `on tail=${hx(entry.mem.read8(TASK_TAIL))}`,
    );

    // The idiomatic routine must NOT model the stack: SP and pc unchanged from entry.
    const b = entry.clone();
    const sp0 = b.regs.sp, pc0 = b.pc;
    composeAttractTitleScreen(b);
    assert.equal(b.regs.sp, sp0, "composeAttractTitleScreen must leave SP unchanged (no stack modelling)");
    assert.equal(b.pc, pc0, "composeAttractTitleScreen must leave pc unchanged (no ret modelling)");
  }
  console.log(`  EQUAL/captured: ${caps.length} real dispatches — game-visible RAM identical to the oracle`);
});

// -- 2. EQUAL (crafted arms) --------------------------------------------------

test("EQUAL (crafted): TWO_PLAYER / TENS_CARRY / FULL_RING arms match the oracle", () => {
  const caps = captureDispatches(1, 3000);
  assert.ok(caps.length >= 1, "need a real entry to craft from");
  const entry = caps[0];

  const arms = [
    ["TWO_PLAYER", (m) => m.mem.write8(TWO_PLAYER_GAME, 0x01)], // draw2UpLabel arm
    ["TENS_CARRY", (m) => m.mem.write8(DIP_COINS_FOR_2P, 0x0a)], // digit-writer D==10 carry
    ["FULL_RING", FULL], // every task post dropped, tail untouched
  ];

  for (const [label, craft] of arms) {
    const a = entry.clone(), b = entry.clone();
    const aFloor = a.regs.sp;
    craft(a); craft(b);
    oracle(a);
    composeAttractTitleScreen(b);
    const { bad } = ramDiffMinusStack(a, b, aFloor);
    assert.equal(
      bad,
      null,
      bad && `${label}: game-visible RAM diff at ${hx(bad.addr)} (oracle=${bad.a} idiomatic=${bad.b})`,
    );
    console.log(`  EQUAL/crafted ${label}: game-visible RAM identical to the oracle`);
  }

  // Positive content check: on a clean ring the handler lays down exactly this payload —
  // the two direct title strings (03 1B, 03 1C) then enqueueTaskBatch's seven messages —
  // and advances the tail by 9 messages x 2 bytes = 18 (0xC0 -> 0xD2).
  const want = [
    0x03, 0x1b, 0x03, 0x1c, // direct title-string posts
    0x04, 0x00, // batch: handler #4 / arg 0
    0x03, 0x14, 0x03, 0x15, 0x03, 0x16, 0x03, 0x17, 0x03, 0x18, 0x03, 0x19, // batch: #3 args
  ];
  const b = entry.clone();
  CLEAN(b);
  composeAttractTitleScreen(b);
  const got = want.map((_, i) => b.mem.read8(RING_LO + i));
  assert.deepEqual(got, want, `clean-ring payload mismatch: got ${got.map(hx).join(" ")}`);
  assert.equal(b.mem.read8(TASK_TAIL), 0xd2, "tail must advance 0xC0 -> 0xD2 (9 messages)");
  console.log(`  EQUAL/crafted payload: ${got.map((v) => v.toString(16).padStart(2, "0")).join(" ")}, tail -> 0xd2`);
});

// -- 3. TEETH -----------------------------------------------------------------

/**
 * Broken twin: DROPS the second title-string post (arg 0x1C) — a plausible off-by-one in
 * the direct posts. It writes one fewer ring slot and advances the tail two short, so it
 * diverges wherever the ring had a free slot. Every other step is the real routine, so
 * the twin differs ONLY in that one post.
 */
function brokenComposeAttractTitleScreen(m) {
  const { regs, mem } = m;
  mem.write8(0x7d86, 0x00);
  mem.write8(0x7d87, 0x00);
  regs.d = 0x03;
  regs.e = 0x1b;
  enqueueTask(m);
  // BUG: the second title-string post (arg 0x1C) is dropped.
  enqueueTaskBatch(m);
  mem.write8(0x6009, 0x02);
  mem.write8(0x600a, (mem.read8(0x600a) + 1) & 0xff);
  clearPlayfieldAndSprites(m);
  draw1UpLabel(m);
  if (mem.read8(TWO_PLAYER_GAME) === 0x01) draw2UpLabel(m);
  regs.de = mem.read16(0x6022);
  regs.hl = 0x756c;
  writeDigitPairWithCarry(m);
  writeDigitPairWithCarry(m);
}

test("TEETH: the dropped-second-title-string twin is CAUGHT (captured + deterministic clean ring)", () => {
  const caps = captureDispatches(64, 9000);
  assert.ok(caps.length >= 1, "need a real dispatch to test the teeth against");

  // Captured sweep (free-ring dispatches diverge; report the first catch).
  let caught = null;
  for (const entry of caps) {
    const { bad } = replay(entry, brokenComposeAttractTitleScreen);
    if (bad) { caught = bad; break; }
  }
  assert.notEqual(caught, null, "the captured sweep FAILED to catch a dropped post — it is worthless");

  // Deterministic clean-ring catch, independent of whatever ring state attract minted.
  const a = caps[0].clone(), b = caps[0].clone();
  const aFloor = a.regs.sp;
  CLEAN(a); CLEAN(b);
  oracle(a);
  brokenComposeAttractTitleScreen(b);
  const { bad } = ramDiffMinusStack(a, b, aFloor);
  assert.notEqual(bad, null, "clean-ring sweep FAILED to catch the dropped post");
  console.log(`  TEETH: caught at ${hx(caught.addr)} (captured) and ${hx(bad.addr)} (clean ring)`);
});
