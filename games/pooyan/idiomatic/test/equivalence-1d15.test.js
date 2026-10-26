// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for clearActorsAndEnterContinueState (ROM 0x1d15) — the full-clear tail of the play-state dispatch
 * handler. Void handler; LIVE-OUT is memory only, comparison is RAM minus stack scratch below the entry SP. Cases: the
 * one-player reseed branch (two-player flag clear) with credit remaining (finish the continue path)
 * and with none (cold teardown), plus the two-player reseed branch (cap-first column stamp).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1d15.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1d15 as oracle } from "../../translated/loc_1d15.js";
import { clearActorsAndEnterContinueState } from "../clearActorsAndEnterContinueState.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TWO_PLAYER_FLAG = 0x880e;
const CREDIT_COUNT = 0x8802;
const MAIN_GAME_STATE = 0x8805;
const FLIP_SCREEN_FLAG = 0x881f;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { twoPlayer = 0, credit = 1 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(TWO_PLAYER_FLAG, twoPlayer);
  m.mem.write8(CREDIT_COUNT, credit);
  m.mem.write8(MAIN_GAME_STATE, 0x55);
  m.mem.write8(FLIP_SCREEN_FLAG, 0x55);
  return m;
}

const CASES = {
  "1P, credit -> continue": (m) => seat(m, { twoPlayer: 0, credit: 1 }),
  "1P, no credit -> teardown": (m) => seat(m, { twoPlayer: 0, credit: 0 }),
  "2P reseed branch": (m) => seat(m, { twoPlayer: 1, credit: 1 }),
};

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: clearActorsAndEnterContinueState == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    clearActorsAndEnterContinueState(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: the continue path arms flip and the continue state", () => {
  const cont = CASES["1P, credit -> continue"](BASE.clone());
  oracle(cont);
  assert.equal(cont.mem.read8(FLIP_SCREEN_FLAG), 1, "flip armed to 1");
  assert.equal(cont.mem.read8(MAIN_GAME_STATE), 2, "continue state 2");
  console.log("  WRITE-SET: flip 1; game state 2");
});

// -- 3. TEETH ----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["1P, credit -> continue"](BASE.clone());
  const c = CASES["1P, credit -> continue"](BASE.clone());
  oracle(o);
  clearActorsAndEnterContinueState(c);
  c.mem.write8(MAIN_GAME_STATE, (o.mem.read8(MAIN_GAME_STATE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the continue writes diverges from the oracle", () => {
  const o = CASES["1P, credit -> continue"](BASE.clone());
  const c = CASES["1P, credit -> continue"](BASE.clone());
  oracle(o);
  // twin: do nothing -> the pre-run 0x55 markers survive
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped continue must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
