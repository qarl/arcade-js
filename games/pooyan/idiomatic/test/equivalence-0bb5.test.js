// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceGameStateOnCreditOrStartPress (ROM 0x0bb5, Pooyan) — the shared attract/board-handler epilogue.
 *
 * Two independent jobs run back to back: (1) a HUD integrity check (only when idle at build state 1
 * in sub-state 3/5/8) that scans a ROM reference list against the tile strip and cross-checks a
 * sub-state ROM lookup, arming the board-clear flag on any disagreement; (2) the coin/credit gate
 * that either advances the top-level state on a waiting credit, or on free play routes the IN0 start
 * bits into the 1P/2P screen builders. advanceGameStateOnCreditOrStartPress is a void epilogue -> equivalence is RAM (dumpState)
 * minus stack scratch below the entry SP.
 *
 * Crafts cover: game-active skip + no-credit ret; credit-advances-state; integrity mismatch (arm);
 * integrity clean pass (no arm, exercises the rst-0x20 lookup dissolve); free-play 1P (0dab, HL=0
 * register bridge) and 2P (0da8) routes.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a waiting credit bumps the top-level state; a mismatch arms the board-clear flag.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips the arm diverges.
 *   4. BRIDGE (R37) — the HL=0 hand-off into the 1P builder re-seats a poisoned HL.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0bb5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0bb5 as oracle } from "../../translated/loc_0b32.js";
import { advanceGameStateOnCreditOrStartPress } from "../advanceGameStateOnCreditOrStartPress.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { bridgeReseatEquivalent } from "../../../../core/bridge-reseat.js";
import { u16 } from "../../../../core/int.js";
import {
  STACK_SCRATCH,
  GAME_ACTIVE_FLAG,
  MAIN_GAME_STATE,
  ATTRACT_SUBSTATE,
  ATTRACT_EPILOGUE_TICK,
  HUD_INTEGRITY_STRIP_B,
  EPILOGUE_HUD_SCAN_REF_TABLE,
  EPILOGUE_SUBSTATE_LOOKUP_TABLE,
  BOARD_CLEAR_FLAG,
  COINAGE_CONFIG,
  CREDIT_COUNT,
  PLAY_STATE_INDEX,
  INPUT_PORT0,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8fe0;
const ROW_STRIDE = 0x20;
const SCAN_TO_CMP_OFFSET = 0xfbc0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function base() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, 0xfffc); // caller-return word for the free-play tail dissolves
  m.mem8[ATTRACT_EPILOGUE_TICK] = 0x00;
  m.mem8[BOARD_CLEAR_FLAG] = 0x00;
  return m;
}

/** Seat the integrity gate open at sub-state 3 and lay the ROM ref list into the tile strip. */
function seatScan(m, { match = true } = {}) {
  m.mem8[GAME_ACTIVE_FLAG] = 0x00;
  m.mem8[MAIN_GAME_STATE] = 0x01;
  m.mem8[ATTRACT_SUBSTATE] = 0x03;
  let k = 0;
  while (m.mem8[EPILOGUE_HUD_SCAN_REF_TABLE + k] !== 0xff) k++;
  for (let j = 0; j < k; j++) {
    m.mem8[u16(HUD_INTEGRITY_STRIP_B - ROW_STRIDE * j)] = m.mem8[EPILOGUE_HUD_SCAN_REF_TABLE + j];
  }
  const scanEnd = u16(HUD_INTEGRITY_STRIP_B - ROW_STRIDE * k);
  const cmp = u16(scanEnd + SCAN_TO_CMP_OFFSET);
  const fetched = m.mem8[EPILOGUE_SUBSTATE_LOOKUP_TABLE + 0x03];
  m.mem8[cmp] = match ? fetched : (fetched ^ 0xff) & 0xff;
  m.mem8[COINAGE_CONFIG] = 0x01; // not free play
  m.mem8[CREDIT_COUNT] = 0x00; // no credit -> ret after the gate
  return m;
}

const CASES = {
  "game active, no credit -> ret": () => {
    const m = base();
    m.mem8[GAME_ACTIVE_FLAG] = 0x01;
    m.mem8[COINAGE_CONFIG] = 0x01;
    m.mem8[CREDIT_COUNT] = 0x00;
    return m;
  },
  "game active, credit -> advance state": () => {
    const m = base();
    m.mem8[GAME_ACTIVE_FLAG] = 0x01;
    m.mem8[COINAGE_CONFIG] = 0x01;
    m.mem8[MAIN_GAME_STATE] = 0x01;
    m.mem8[PLAY_STATE_INDEX] = 0x55;
    m.mem8[CREDIT_COUNT] = 0x05;
    return m;
  },
  "integrity mismatch -> arm": () => {
    const m = seatScan(base(), { match: false });
    m.mem8[HUD_INTEGRITY_STRIP_B] = (m.mem8[EPILOGUE_HUD_SCAN_REF_TABLE] ^ 0xff) & 0xff; // first byte diverges
    return m;
  },
  "integrity clean pass -> no arm": () => seatScan(base(), { match: true }),
  "free play, 1P start -> 0dab": () => {
    const m = base();
    m.mem8[GAME_ACTIVE_FLAG] = 0x01; // skip integrity
    m.mem8[COINAGE_CONFIG] = 0x0f; // free play
    m.mem8[INPUT_PORT0] = 0x08; // bit3 set -> 1P builder
    return m;
  },
  "free play, 2P start -> 0da8": () => {
    const m = base();
    m.mem8[GAME_ACTIVE_FLAG] = 0x01;
    m.mem8[COINAGE_CONFIG] = 0x0f;
    m.mem8[INPUT_PORT0] = 0x10; // bit3 clear, bit4 set -> 2P builder
    return m;
  },
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceGameStateOnCreditOrStartPress == oracle in RAM (−stack)", () => {
  for (const [name, mk] of Object.entries(CASES)) {
    const o = mk();
    const c = mk();
    oracle(o);
    advanceGameStateOnCreditOrStartPress(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a credit advances the state; a mismatch arms board-clear", () => {
  const adv = CASES["game active, credit -> advance state"]();
  oracle(adv);
  assert.equal(adv.mem8[MAIN_GAME_STATE], 0x02, "top-level state bumped 1 -> 2");
  assert.equal(adv.mem8[PLAY_STATE_INDEX], 0x00, "play sub-state cleared");

  const arm = CASES["integrity mismatch -> arm"]();
  oracle(arm);
  assert.equal(arm.mem8[BOARD_CLEAR_FLAG], 0x01, "scan mismatch armed the board-clear flag");
  console.log("  WRITE-SET: credit->state++, mismatch->arm");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["game active, credit -> advance state"]();
  const c = CASES["game active, credit -> advance state"]();
  oracle(o);
  advanceGameStateOnCreditOrStartPress(c);
  c.mem8[MAIN_GAME_STATE] = (o.mem8[MAIN_GAME_STATE] ^ 0xff) & 0xff;
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the board-clear arm diverges from the oracle", () => {
  const o = CASES["integrity mismatch -> arm"]();
  const c = CASES["integrity mismatch -> arm"]();
  oracle(o);
  advanceGameStateOnCreditOrStartPress(c);
  c.mem8[BOARD_CLEAR_FLAG] = 0x00; // regress the arm the epilogue performed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped arm must be caught");
  assert.equal(d.addr, BOARD_CLEAR_FLAG, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(arm): caught at ${hx(d.addr)}`);
});

// -- 4. BRIDGE (R37) ----------------------------------------------------------

test("BRIDGE: the 1P builder HL=0 hand-off re-seats a poisoned HL", () => {
  const r = bridgeReseatEquivalent(CASES["free play, 1P start -> 0dab"](), oracle, advanceGameStateOnCreditOrStartPress, {
    live: { hl: 0x0000 },
    poison: { hl: 0xbeef },
    excludeAddr: inDeadStack,
  });
  assert.equal(r.equal, true, r.ram && `bridge leaked at ${hx(r.ram.addr ?? 0)}: oracle=${r.ram.a} module=${r.ram.b}`);
  console.log("  BRIDGE: HL re-seated to 0 before the 1P builder (poison did not leak)");
});
