// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for beginTwoPlayerStartOfLife (ROM 0x0da8, Pooyan) — the thin start-of-life entry.
 *
 * beginTwoPlayerStartOfLife seats HL = 0x0100 (the state seed) and falls through to startNewGamePlay. The dissolved tail runs
 * the idiomatic startNewGamePlay, so equality is transitive on startNewGamePlay's gate; beginTwoPlayerStartOfLife's own contract is
 * that it delivers the 0x0100 seed to startNewGamePlay regardless of the incoming HL bridge.
 *
 * Cycle-free memory-equivalence: a fresh clone per side, RAM (dumpState) minus stack scratch below the entry SP.
 * No register live-out. SP parked in dead stack scratch.
 *
 * Jobs:
 *   1. EQUAL — module == oracle (RAM −stack) from a booted clone.
 *   2. BRIDGE — a poisoned incoming HL is re-seated to 0x0100 (bridgeReseatEquivalent): the seed the
 *      oracle's `ld hl,0x0100` delivers must not leak the caller's HL into startNewGamePlay.
 *   3. TEETH — a corrupted 0x8805 byte (startNewGamePlay sets it to 3) is CAUGHT; the bridge tooth has teeth
 *      (poison != live).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0da8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0da8 as oracle } from "../../translated/loc_0cf8.js";
import { beginTwoPlayerStartOfLife } from "../beginTwoPlayerStartOfLife.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { bridgeReseatEquivalent } from "../../../../core/bridge-reseat.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const MAIN_GAME_STATE = 0x8805;
const PLAYER_CTRL = 0x880e;
const RING_WRITE_PTR = 0x88a0;
const RING_PAGE = 0x8800;
const RING_START = 0xc0;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A booted clone: bit0-clear control byte (startNewGamePlay's shorter path) and a freed display ring. */
function craft() {
  const m = BASE.clone();
  m.mem.write8(PLAYER_CTRL, 0x00);
  m.mem.write8(RING_WRITE_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  m.regs.sp = SP0;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: beginTwoPlayerStartOfLife == oracle in RAM (−stack)", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  beginTwoPlayerStartOfLife(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(o.mem.read8(MAIN_GAME_STATE), 0x03, "startNewGamePlay seats the main game state to 3");
  console.log("  EQUAL: beginTwoPlayerStartOfLife identical to oracle (RAM −stack)");
});

// -- 2. BRIDGE ----------------------------------------------------------------

test("BRIDGE: a poisoned incoming HL is re-seated to 0x0100 for startNewGamePlay", () => {
  const { equal, ram } = bridgeReseatEquivalent(craft(), oracle, beginTwoPlayerStartOfLife, {
    live: { hl: 0x1234 },
    poison: { hl: 0x0000 }, // != live: the tooth has teeth
    args: [],
    excludeAddr: inDeadStack,
  });
  assert.equal(equal, true, ram && `HL not re-seated: RAM diff at ${hx(ram.addr ?? 0)}: oracle=${ram.a} module=${ram.b}`);
  console.log("  BRIDGE: incoming HL re-seated (poison recovered)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted 0x8805 byte is CAUGHT by the RAM diff", () => {
  const o = craft();
  const c = craft();
  oracle(o);
  beginTwoPlayerStartOfLife(c);
  c.mem.write8(MAIN_GAME_STATE, (o.mem.read8(MAIN_GAME_STATE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted state byte");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: caught at ${hx(d.addr)}`);
});
