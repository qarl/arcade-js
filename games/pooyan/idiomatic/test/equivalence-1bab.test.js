// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for saveLivePageToPlayer0Bank (ROM 0x1bab) — "snapshot the live
 * actor/state page into player 0's saved bank": copy the 0x3f-byte live page (0x8900) into
 * player-0's bank (0x8940), reset the play sub-state index (0x880a) to 0, and — only in a
 * two-player game with player 1 still alive (0x880e != 0 && 0x8988 != 0) — latch the
 * active-player flag (0x880d) to 1.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM, so every case
 * uses a FRESH clone per side. The oracle runs on one clone, the module on another, and they
 * are compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).
 *
 * The routine takes NO register inputs (it reads absolute cells) and returns nothing the
 * caller consumes — it is a dispatch-table handler that just mutates memory. So the contract
 * is memory only.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — hook 0x1bab in a real run; any dispatch must agree in RAM.
 *   2. CRAFTED — the load-bearing arm. All three gate branches (both-nonzero / p1-dead /
 *      not-two-player), pre-dirtied bank + varied source pattern; both sides land identically.
 *   3. TEETH — a twin that copies a WRONG source byte MUST be caught in the bank.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1bab.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1bab as oracle } from "../../translated/loc_1bab.js";
import { saveLivePageToPlayer0Bank } from "../saveLivePageToPlayer0Bank.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  TWO_PLAYER_FLAG,
  PLAYER1_LIVES,
  ACTIVE_PLAYER,
  SPEED_INDEX,
  PLAYER0_STATE_BANK,
  PLAY_STATE_INDEX,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x1bab;
const BANK_SIZE = 0x3f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

/**
 * Build a machine: live page (0x8900..) filled with a varied pattern, player-0 bank
 * (0x8940..) pre-dirtied to 0xAA, PLAY_STATE_INDEX pre-set nonzero (to prove the clear),
 * ACTIVE_PLAYER pre-set to a sentinel (to prove the conditional latch), and the two gate
 * cells seeded to the requested branch.
 */
function craft(twoPlayer, p1Lives, seed = 0x11) {
  const m = new Machine(ROM);
  for (let i = 0; i < BANK_SIZE; i++) {
    m.mem.write8((SPEED_INDEX + i) & 0xffff, (seed + i * 7) & 0xff); // live-page source pattern
    m.mem.write8((PLAYER0_STATE_BANK + i) & 0xffff, 0xaa); // dirty the destination bank
  }
  m.mem.write8(TWO_PLAYER_FLAG, twoPlayer & 0xff);
  m.mem.write8(PLAYER1_LIVES, p1Lives & 0xff);
  m.mem.write8(ACTIVE_PLAYER, 0xee); // sentinel: stays unless the both-nonzero branch latches 1
  m.mem.write8(PLAY_STATE_INDEX, 0x07); // nonzero: must be cleared to 0
  return m;
}

// Branch matrix: [twoPlayer, p1Lives, expectLatch]
const CASES = [
  [0x01, 0x03, true], // two-player, player 1 alive -> latch 0x880d = 1
  [0x00, 0x03, false], // not two-player -> no latch
  [0x01, 0x00, false], // two-player but player 1 dead -> no latch
  [0x80, 0x01, true], // any nonzero pair latches
];

// -- 1. CAPTURE (best-effort) -------------------------------------------------

function captureDispatches(K, maxFrames) {
  const caps = [];
  const snap = new Map([[TARGET, (mm) => {
    if (caps.length < K) caps.push(mm.clone());
    return oracle(mm);
  }]]);
  const host = new Machine(ROM, { overrides: snap });
  host.runFrames(maxFrames);
  return caps;
}

const CAPS = ROM_PRESENT ? captureDispatches(16, 4000) : [];

test("CAPTURE: real 0x1bab dispatches — module == oracle in RAM (−stack)", () => {
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    saveLivePageToPlayer0Bank(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: all branches — RAM identical, bank copied, state cleared, latch correct", () => {
  for (const [twoPlayer, p1Lives, expectLatch] of CASES) {
    const o = craft(twoPlayer, p1Lives);
    const c = craft(twoPlayer, p1Lives);
    oracle(o);
    saveLivePageToPlayer0Bank(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `case ${twoPlayer}/${p1Lives}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    // The whole bank matches the live page on the module side.
    for (let i = 0; i < BANK_SIZE; i++) {
      assert.equal(
        c.mem.read8((PLAYER0_STATE_BANK + i) & 0xffff),
        c.mem.read8((SPEED_INDEX + i) & 0xffff),
        `case ${twoPlayer}/${p1Lives}: bank byte +${hx(i)}`,
      );
    }
    assert.equal(c.mem.read8(PLAY_STATE_INDEX), 0x00, "state index cleared");
    assert.equal(c.mem.read8(ACTIVE_PLAYER), expectLatch ? 0x01 : 0xee, "active-player latch");
  }
  console.log(`  CRAFTED: ${CASES.length} branch cases identical`);
});

// -- 3. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts one copied bank byte — must be caught in the bank. */
function brokenSaveLivePage(m) {
  saveLivePageToPlayer0Bank(m);
  const a = (PLAYER0_STATE_BANK + 5) & 0xffff;
  m.mem.write8(a, (m.mem.read8(a) ^ 0x01) & 0xff); // BUG: wrong bank byte
}

test("TEETH: a wrong copied bank byte is CAUGHT", () => {
  let caught = null;
  for (const [twoPlayer, p1Lives] of CASES) {
    const o = craft(twoPlayer, p1Lives);
    const c = craft(twoPlayer, p1Lives);
    oracle(o);
    brokenSaveLivePage(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = d; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a wrong bank byte — it is worthless");
  assert.equal(caught.addr, (PLAYER0_STATE_BANK + 5) & 0xffff, `teeth caught wrong address ${hx(caught.addr ?? 0)}`);
  console.log(`  TEETH: wrong bank byte caught at ${hx(caught.addr)} (oracle=${caught.a} broken=${caught.b})`);
});
