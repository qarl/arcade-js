// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for saveLiveStateToPlayerBank (ROM 0x1a47) — "save the live
 * actor/state page into the active player's bank": clear the (H:0x04) status byte the caller
 * seated, block-copy the 0x3f-byte live page (0x8900) into the active player's bank
 * (player 0's unless ACTIVE_PLAYER is nonzero, then player 1's), then zero PLAY_STATE_INDEX.
 *
 * saveLiveStateToPlayerBank WRITES RAM, so every case uses a FRESH clone per side. The oracle
 * runs on one clone, the module on another, compared on the go-forward contract:
 *
 *     RAM (dumpState, minus stack scratch below the entry SP).  (No register live-out: the routine is memory-only.)
 *
 * The register input is the caller's H page; the oracle reads regs.hl (forcing L=0x04) and the
 * module its sanctioned default regs.h, so both address the same status byte.
 *
 * Jobs:
 *   1. CAPTURE (best-effort) — this player-swap leaf is not reached in a short attract, so
 *      CRAFTED is load-bearing.
 *   2. CRAFTED — both players, and both an in-page (0x89) and a color-RAM (0x81) status page;
 *      RAM identical.
 *   3. WRITE-SET — the oracle touches only the status byte, the dest bank, and PLAY_STATE_INDEX.
 *   4. TEETH — a twin that corrupts one copied byte MUST be caught in the dest bank.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1a47.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1a47 as oracle } from "../../translated/loc_1a47.js";
import { saveLiveStateToPlayerBank } from "../saveLiveStateToPlayerBank.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ACTIVE_PLAYER,
  PLAYER0_STATE_BANK,
  PLAYER1_STATE_BANK,
  PLAY_STATE_INDEX,
  SPEED_INDEX,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built" }, fn);

const TARGET = 0x1a47;
const LIVE_PAGE = SPEED_INDEX; // 0x8900, base of the live page copied out
const BANK_SIZE = 0x3f;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0); // crafted entries keep the reset SP 0, so no scratch cell lies below it

/** First RAM difference on the go-forward contract: whole dump minus stack scratch below the entry SP. */
function ramDiffMinusStack(ma, mb, dead = inDeadStack) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), dead);
}

const statusAddr = (page) => ((page << 8) | 0x04) & 0xffff;
const destBank = (activePlayer) => (activePlayer === 0 ? PLAYER0_STATE_BANK : PLAYER1_STATE_BANK);

/**
 * Seed: caller H page in HL (L don't-care), ACTIVE_PLAYER, a non-0xAA live-page pattern, and
 * pre-dirtied dest banks + nonzero PLAY_STATE_INDEX + nonzero status byte so every write shows.
 */
function craft(page, activePlayer) {
  const m = new Machine(ROM);
  m.regs.hl = (page << 8) & 0xffff; // H = page; the routine forces L = 0x04
  m.mem.write8(ACTIVE_PLAYER, activePlayer);
  for (let i = 0; i < BANK_SIZE; i++) m.mem.write8((LIVE_PAGE + i) & 0xffff, (0x11 + i) & 0xff);
  for (let i = 0; i < BANK_SIZE; i++) {
    m.mem.write8((PLAYER0_STATE_BANK + i) & 0xffff, 0xaa);
    m.mem.write8((PLAYER1_STATE_BANK + i) & 0xffff, 0xaa);
  }
  m.mem.write8(PLAY_STATE_INDEX, 0x5c);
  m.mem.write8(statusAddr(page), 0x77);
  return m;
}

const CASES = [
  { page: 0x89, activePlayer: 0x00 }, // status 0x8904 sits inside the live page; player 0
  { page: 0x89, activePlayer: 0x01 }, // player 1 bank
  { page: 0x81, activePlayer: 0x00 }, // status 0x8104 in color RAM, outside the live page
  { page: 0x81, activePlayer: 0x03 }, // any nonzero ACTIVE_PLAYER -> player 1 bank
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

const CAPS = ROM_PRESENT ? captureDispatches(32, 4000) : [];

test("CAPTURE: real 0x1a47 dispatches — saveLiveStateToPlayerBank == oracle in RAM (−stack)", () => {
  if (CAPS.length === 0) {
    console.log("  CAPTURE: no real 0x1a47 dispatch in the window — CRAFTED is load-bearing");
    return;
  }
  for (const cap of CAPS) {
    const o = cap.clone();
    const c = cap.clone();
    oracle(o);
    saveLiveStateToPlayerBank(c);
    const d = ramDiffMinusStack(o, c, deadStackBelow(STACK_SCRATCH, cap.regs.sp));
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  CAPTURE: ${CAPS.length} real dispatch(es) checked`);
});

// -- 2. CRAFTED (load-bearing) ------------------------------------------------

test("CRAFTED: both players + both status pages — RAM identical", () => {
  for (const cs of CASES) {
    const o = craft(cs.page, cs.activePlayer);
    const c = craft(cs.page, cs.activePlayer);
    oracle(o);
    saveLiveStateToPlayerBank(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `case ${JSON.stringify(cs)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);

    // Positively check the module landed the expected writes.
    const dest = destBank(cs.activePlayer);
    assert.equal(c.mem.read8(statusAddr(cs.page)), 0x00, `case ${JSON.stringify(cs)}: status byte not cleared`);
    for (let i = 0; i < BANK_SIZE; i++) {
      assert.equal(
        c.mem.read8((dest + i) & 0xffff),
        c.mem.read8((LIVE_PAGE + i) & 0xffff),
        `case ${JSON.stringify(cs)}: dest+${hx(i)} != live+${hx(i)}`,
      );
    }
    assert.equal(c.mem.read8(PLAY_STATE_INDEX), 0x00, `case ${JSON.stringify(cs)}: PLAY_STATE_INDEX not zeroed`);
  }
  console.log(`  CRAFTED: ${CASES.length} cases copied identically`);
});

// -- 3. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the oracle touches only the status byte, the dest bank, and PLAY_STATE_INDEX", () => {
  for (const cs of CASES) {
    const before = craft(cs.page, cs.activePlayer);
    const after = before.clone();
    const b0 = before.dumpState();
    oracle(after);
    const a1 = after.dumpState();

    const dest = destBank(cs.activePlayer);
    const allowed = new Set([statusAddr(cs.page), PLAY_STATE_INDEX]);
    for (let i = 0; i < BANK_SIZE; i++) allowed.add((dest + i) & 0xffff);

    for (let off = 0; off < b0.length; off++) {
      if (b0[off] === a1[off]) continue;
      const addr = after.stateOffsetToAddr(off);
      assert.ok(allowed.has(addr), `case ${JSON.stringify(cs)}: oracle wrote unexpected addr ${hx(addr)}`);
    }
    // The three landmark writes actually changed (seeds chosen so each differs from its new value).
    assert.notEqual(before.mem.read8(PLAY_STATE_INDEX), after.mem.read8(PLAY_STATE_INDEX));
  }
  console.log("  WRITE-SET: every oracle write is the status byte, the dest bank, or PLAY_STATE_INDEX");
});

// -- 4. TEETH -----------------------------------------------------------------

/** Broken twin: corrupts one copied byte in the dest bank — must be caught there. */
function brokenSave(m) {
  saveLiveStateToPlayerBank(m);
  const dest = m.mem.read8(ACTIVE_PLAYER) === 0 ? PLAYER0_STATE_BANK : PLAYER1_STATE_BANK;
  m.mem.write8((dest + 0x10) & 0xffff, (m.mem.read8((dest + 0x10) & 0xffff) + 1) & 0xff); // BUG
}

test("TEETH: a corrupted copied byte is CAUGHT in the dest bank", () => {
  let caught = null;
  for (const cs of CASES) {
    const o = craft(cs.page, cs.activePlayer);
    const c = craft(cs.page, cs.activePlayer);
    oracle(o);
    brokenSave(c);
    const d = ramDiffMinusStack(o, c);
    if (d) { caught = { cs, d }; break; }
  }
  assert.notEqual(caught, null, "the gate FAILED to catch a corrupted copied byte — it is worthless");
  const dest = destBank(caught.cs.activePlayer);
  assert.equal(caught.d.addr, (dest + 0x10) & 0xffff, `teeth caught the wrong address ${hx(caught.d.addr ?? 0)}`);
  console.log(`  TEETH: corrupted copy caught at ${hx(caught.d.addr)}`);
});
