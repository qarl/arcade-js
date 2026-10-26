// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for reseedOtherPlayerForTurn (ROM 0x1cf6) — the reseed-the-other-player tail of the
 * play-state dispatch handler. Void handler; LIVE-OUT is memory only, comparison is RAM minus
 * stack scratch below the entry SP. Cases: player-1 out of lives (delegate to the full-clear tail) and player-1 alive
 * (clear sub-state, zero player-0's bank via the frozen fill, mark player 0 active, reset the display
 * pointer, tail into the shared reseed body).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1cf6.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1cf6 as oracle } from "../../translated/loc_1cf6.js";
import { reseedOtherPlayerForTurn } from "../reseedOtherPlayerForTurn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PLAYER1_LIVES = 0x8988;
const PLAY_STATE_INDEX = 0x880a;
const ACTIVE_PLAYER = 0x880d;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { lives = 3 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(PLAYER1_LIVES, lives);
  m.mem.write8(PLAY_STATE_INDEX, 0x55);
  m.mem.write8(ACTIVE_PLAYER, 0x55);
  return m;
}

const CASES = {
  "no player-1 lives -> delegate full clear": (m) => seat(m, { lives: 0 }),
  "player-1 alive -> reseed player 0": (m) => seat(m, { lives: 3 }),
};

// -- 1. EQUAL ----------------------------------------------------------------

test("EQUAL: reseedOtherPlayerForTurn == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    reseedOtherPlayerForTurn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET ------------------------------------------------------------

test("WRITE-SET: the alive path clears the sub-state and marks player 0 active", () => {
  const alive = CASES["player-1 alive -> reseed player 0"](BASE.clone());
  oracle(alive);
  assert.equal(alive.mem.read8(PLAY_STATE_INDEX), 0, "sub-state cleared");
  assert.equal(alive.mem.read8(ACTIVE_PLAYER), 1, "player 0 marked active");
  console.log("  WRITE-SET: sub-state 0; active player 1");
});

// -- 3. TEETH ----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["player-1 alive -> reseed player 0"](BASE.clone());
  const c = CASES["player-1 alive -> reseed player 0"](BASE.clone());
  oracle(o);
  reseedOtherPlayerForTurn(c);
  c.mem.write8(ACTIVE_PLAYER, (o.mem.read8(ACTIVE_PLAYER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, ACTIVE_PLAYER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the reseed diverges from the oracle", () => {
  const o = CASES["player-1 alive -> reseed player 0"](BASE.clone());
  const c = CASES["player-1 alive -> reseed player 0"](BASE.clone());
  oracle(o);
  // twin: do nothing -> the pre-run 0x55 markers survive
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped reseed must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
