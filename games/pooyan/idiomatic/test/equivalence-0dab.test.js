// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for startNewGamePlay (ROM 0x0dab, Pooyan) — start-of-life setup for a new game.
 *
 * Records the active-player word (low byte -> player index at 0x880d, high byte -> two-player flag
 * at 0x880e), runs the frozen pre-play display setup (loc_0e54, KEPT), seeds the top-level state,
 * enqueues the 0x0604 start command (enqueueDisplayCommand, dissolved), resets the actor tables (loc_0e00, KEPT),
 * primes the periodic-event pair, enqueues the start-of-life sound, and — on a two-player game —
 * enqueues the second-player variant and clears a 12-byte panel block (fillByteRun, dissolved).
 *
 * Both sides call the SAME frozen loc_0e54 / loc_0e00, and the dissolved enqueueDisplayCommand / fillByteRun carry
 * their own gates, so this gate proves startNewGamePlay's own writes and branch. The display-command ring is
 * freed so the enqueues land; SP is parked in STACK_SCRATCH so the KEPT calls' push/ret drop out of
 * the RAM diff. Compared on RAM (dumpState, minus stack scratch below the entry SP). No register live-out — memory only.
 *
 * The active-player word drives the branch: high byte bit0 clear (1P) -> early return before the
 * panel clear; set (2P) -> the full path. Both are crafted.
 *
 * Jobs:
 *   1. EQUAL — 1P (early return) and 2P (full path): module == oracle in RAM (−stack).
 *   2. WRITE-SET — the state cells are seeded; 2P clears the panel block, 1P leaves it dirty.
 *   3. TEETH — a corrupted state byte is caught; a twin that skips the flip-screen write diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0dab.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0dab as oracle } from "../../translated/loc_0cf8.js";
import { startNewGamePlay } from "../startNewGamePlay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ACTIVE_PLAYER = 0x880d;
const TWO_PLAYER_FLAG = 0x880e;
const PLAY_STATE_INDEX = 0x880a;
const MAIN_GAME_STATE = 0x8805;
const GAME_ACTIVE_FLAG = 0x8806;
const FLIP_SCREEN_FLAG = 0x881f;
const WAVE_EVENT_LATCH = 0x8d21;
const PERIODIC_EVENT_TIMER = 0x8d22;
const PANEL_BLOCK = 0x8e1f; // 12-byte block cleared only on 2P

const RING_WRITE_PTR = 0x88a0;
const RING_PAGE = 0x8800;
const RING_START = 0xc0;
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: active-player word in HL, a freed ring, state + panel cells pre-dirtied. */
function craft(player) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.hl = player & 0xffff;
  m.mem.write8(RING_WRITE_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  for (const cell of [PLAY_STATE_INDEX, MAIN_GAME_STATE, GAME_ACTIVE_FLAG, FLIP_SCREEN_FLAG, WAVE_EVENT_LATCH]) {
    m.mem.write8(cell, 0xaa); // pre-dirty so a to-zero (or missing) write is observable
  }
  for (let i = 0; i < 12; i++) m.mem.write8(PANEL_BLOCK + i, 0x55); // dirty the panel block
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: 1P (early return) and 2P (full path) — startNewGamePlay == oracle in RAM (−stack)", () => {
  for (const [name, player] of [
    ["1P: high byte bit0 clear -> early return", 0x0000],
    ["2P: high byte bit0 set -> full path", 0x0100],
  ]) {
    const o = craft(player);
    const c = craft(player);
    oracle(o);
    startNewGamePlay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: 1P + 2P paths identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the state cells are seeded; 2P clears the panel block, 1P leaves it dirty", () => {
  const two = craft(0x0100);
  oracle(two);
  assert.equal(two.mem.read8(ACTIVE_PLAYER), 0x00, "active-player index = low byte");
  assert.equal(two.mem.read8(TWO_PLAYER_FLAG), 0x01, "two-player flag = high byte");
  assert.equal(two.mem.read8(MAIN_GAME_STATE), 0x03, "main state -> 3");
  assert.equal(two.mem.read8(GAME_ACTIVE_FLAG), 0x01, "in-play flag set");
  assert.equal(two.mem.read8(FLIP_SCREEN_FLAG), 0x01, "flip-screen normal");
  assert.equal(two.mem.read8(WAVE_EVENT_LATCH), 0x00, "wave-event latch cleared");
  assert.equal(two.mem.read8(PERIODIC_EVENT_TIMER), 0x20, "periodic timer reloaded to 0x20");
  assert.equal(two.mem.read8(PANEL_BLOCK), 0x00, "2P clears the panel block");

  const one = craft(0x0000);
  oracle(one);
  assert.equal(one.mem.read8(PANEL_BLOCK), 0x55, "1P leaves the panel block untouched");
  console.log("  WRITE-SET: state seeded; 2P clears panel, 1P does not");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted state byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x0100);
  const c = craft(0x0100);
  oracle(o);
  startNewGamePlay(c);
  c.mem.write8(MAIN_GAME_STATE, (o.mem.read8(MAIN_GAME_STATE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted state byte");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(state): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the flip-screen write diverges from the oracle", () => {
  const o = craft(0x0100);
  const c = craft(0x0100);
  oracle(o);
  startNewGamePlay(c);
  c.mem.write8(FLIP_SCREEN_FLAG, 0xaa); // twin: revert the flip-screen write to its dirty seed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped flip-screen write must be caught");
  assert.equal(d.addr, FLIP_SCREEN_FLAG, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(flip): caught at ${hx(d.addr)}`);
});
