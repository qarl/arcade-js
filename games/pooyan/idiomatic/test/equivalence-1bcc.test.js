// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for snapshotPlayer1BankWithSignatureCheck (ROM 0x1bcc) — "snapshot live page + signature tripwire":
 * optionally deselect player 0, copy the 0x3f-byte live state page into player 1's bank, clear the
 * play sub-state index, then fold a fixed ROM code block onto the leftover copy pointer and bump the
 * signature tamper counter unless the fold lands on its sentinel word.
 *
 * This is the cycle-free / memory-equivalence gate. The routine takes NO register inputs (it seeds
 * every pointer from constants and memory) and returns via a plain ret, so the contract is RAM only
 * (dumpState minus stack scratch below the entry SP); there is no register live-out (A is left as scratch, unconsumed).
 * pc/SP/cycles are deliberately not compared.
 *
 * The checksum reads intact program ROM, so both sides compute the identical fold and agree on
 * whether the counter is bumped — the case is natural, not crafted around a known ROM value.
 *
 * Jobs:
 *   1. EQUAL — over several seeded live pages / lives values, oracle == snapshotPlayer1BankWithSignatureCheck in RAM (−stack).
 *   2. WRITE-SET — the oracle's writes are a subset of {ACTIVE_PLAYER, the 0x3f bank cells,
 *      PLAY_STATE_INDEX, TAMPER_STRIKES_SIG}; the bank equals the copied live page.
 *   3. CRAFTED — player-0-alive arm (lives != 0) forces the ACTIVE_PLAYER clear a fresh boot omits.
 *   4. TEETH — a twin with a corrupted bank byte AND a twin that skips the PLAY_STATE_INDEX clear are
 *      both caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1bcc.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1bcc as oracle } from "../../translated/loc_1bcc.js";
import { snapshotPlayer1BankWithSignatureCheck } from "../snapshotPlayer1BankWithSignatureCheck.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PLAYER0_LIVES = 0x8948;
const ACTIVE_PLAYER = 0x880d;
const LIVE_PAGE = 0x8900;
const PLAYER1_BANK = 0x8980;
const PLAY_STATE_INDEX = 0x880a;
const TAMPER_SIG = 0x8a38;
const BANK_SIZE = 0x3f;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff8);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: lives value, a seeded live page, and pre-dirtied output cells. */
function craft(lives, pageSeed) {
  const m = BASE.clone();
  m.regs.sp = 0x8ff8; // ret only POPs (reads) work RAM here
  m.mem.write8(PLAYER0_LIVES, lives & 0xff);
  for (let i = 0; i < BANK_SIZE; i++) m.mem.write8(LIVE_PAGE + i, (pageSeed + i) & 0xff);
  m.mem.write8(ACTIVE_PLAYER, 0x7f); // pre-dirty: only the lives!=0 arm should clear it
  m.mem.write8(PLAY_STATE_INDEX, 0x7f); // pre-dirty: always cleared
  return m;
}

const CASES = [
  { lives: 0, pageSeed: 0x11 },
  { lives: 3, pageSeed: 0x40 },
  { lives: 1, pageSeed: 0xf0 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: seeded lives/live-page — snapshotPlayer1BankWithSignatureCheck == oracle in RAM (−stack)", () => {
  for (const { lives, pageSeed } of CASES) {
    const o = craft(lives, pageSeed);
    const c = craft(lives, pageSeed);
    oracle(o);
    snapshotPlayer1BankWithSignatureCheck(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b} (lives=${lives} seed=${hx(pageSeed)})`);
  }
  console.log(`  EQUAL: ${CASES.length} cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: writes ⊆ {ACTIVE_PLAYER, bank, PLAY_STATE_INDEX, TAMPER_SIG}; bank==live page", () => {
  const { lives, pageSeed } = CASES[1];
  const before = craft(lives, pageSeed);
  const after = craft(lives, pageSeed);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const allowed = new Set([ACTIVE_PLAYER, PLAY_STATE_INDEX, TAMPER_SIG]);
  for (let i = 0; i < BANK_SIZE; i++) allowed.add(PLAYER1_BANK + i);

  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = after.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    assert.ok(allowed.has(addr), `unexpected write at ${hx(addr)} (${b0[off]}->${a1[off]})`);
  }
  assert.equal(after.mem.read8(PLAY_STATE_INDEX), 0, "PLAY_STATE_INDEX must be cleared");
  assert.equal(after.mem.read8(ACTIVE_PLAYER), 0, "lives!=0 must clear ACTIVE_PLAYER");
  for (let i = 0; i < BANK_SIZE; i++) {
    assert.equal(after.mem.read8(PLAYER1_BANK + i), after.mem.read8(LIVE_PAGE + i), `bank[${i}] must equal live page`);
  }
  console.log("  WRITE-SET: bank copied, index cleared, footprint within contract");
});

// -- 3. CRAFTED ---------------------------------------------------------------

test("CRAFTED: lives==0 leaves ACTIVE_PLAYER dirty; lives!=0 clears it (both == oracle)", () => {
  // lives==0 arm: ACTIVE_PLAYER is NOT written (stays pre-dirtied 0x7f) — craft-only vs a fresh boot.
  const oZero = craft(0, 0x22);
  const cZero = craft(0, 0x22);
  oracle(oZero);
  snapshotPlayer1BankWithSignatureCheck(cZero);
  assert.equal(cZero.mem.read8(ACTIVE_PLAYER), 0x7f, "lives==0 must not touch ACTIVE_PLAYER");
  assert.equal(ramDiffMinusStack(oZero, cZero), null, "lives==0 arm must match oracle");

  const oLive = craft(2, 0x22);
  const cLive = craft(2, 0x22);
  oracle(oLive);
  snapshotPlayer1BankWithSignatureCheck(cLive);
  assert.equal(cLive.mem.read8(ACTIVE_PLAYER), 0, "lives!=0 must clear ACTIVE_PLAYER");
  assert.equal(ramDiffMinusStack(oLive, cLive), null, "lives!=0 arm must match oracle");
  console.log("  CRAFTED: both lives arms confirmed");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted bank byte is CAUGHT by the RAM diff", () => {
  const { lives, pageSeed } = CASES[0];
  const o = craft(lives, pageSeed);
  const c = craft(lives, pageSeed);
  oracle(o);
  snapshotPlayer1BankWithSignatureCheck(c);
  c.mem.write8(PLAYER1_BANK + 5, 0xee); // BUG: bank byte 5 corrupted
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted bank byte");
  assert.equal(d.addr, PLAYER1_BANK + 5, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/bank: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: skipping the PLAY_STATE_INDEX clear is CAUGHT", () => {
  const { lives, pageSeed } = CASES[1];
  const o = craft(lives, pageSeed);
  const c = craft(lives, pageSeed);
  oracle(o);
  snapshotPlayer1BankWithSignatureCheck(c);
  c.mem.write8(PLAY_STATE_INDEX, 0x7f); // BUG: index left as its dirty pre-value
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an un-cleared PLAY_STATE_INDEX");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/index: caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
