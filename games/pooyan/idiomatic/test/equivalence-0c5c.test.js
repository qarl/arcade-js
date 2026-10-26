// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for primeTileFillCursorAndAdvanceBoardBuild (ROM 0x0c5c, Pooyan) — board-build state 0.
 *
 * Clears the state scratch byte, kicks the watchdog, drops the in-play flag, seats the row-fill
 * cursor at the playfield paint origin, primes the row counter, advances the sub-state, then
 * delegates to zeroSpriteListAndActorArena to zero the board-init RAM regions. The register live-out (A/B/HL seated by
 * the delegate) is not read across the ret's memory footprint, so equivalence is RAM (dumpState)
 * minus stack scratch below the entry SP.
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack).
 *   2. WRITE-SET — the cursor, counter, flags land and the sub-state is bumped.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips the sub-state bump diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0c5c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c5c as oracle } from "../../translated/loc_0c45.js";
import { primeTileFillCursorAndAdvanceBoardBuild } from "../primeTileFillCursorAndAdvanceBoardBuild.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  loc_8819,
  GAME_ACTIVE_FLAG,
  TILE_FILL_PTR,
  PLAYFIELD_PAINT_START,
  FILL_ROW_COUNTER,
  PLAY_STATE_INDEX,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Pre-dirty the cells the handler seats so every write is observable. */
function craft(state) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[loc_8819] = 0x55;
  m.mem8[GAME_ACTIVE_FLAG] = 0x55;
  m.mem8[FILL_ROW_COUNTER] = 0x55;
  m.mem8[PLAY_STATE_INDEX] = state & 0xff;
  m.mem.write16(TILE_FILL_PTR, 0x5555);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: primeTileFillCursorAndAdvanceBoardBuild == oracle in RAM (−stack)", () => {
  for (const state of [0x00, 0x03]) {
    const o = craft(state);
    const c = craft(state);
    oracle(o);
    primeTileFillCursorAndAdvanceBoardBuild(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `state ${state}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: state-0 handler identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: cursor + counter + flags land, sub-state bumped", () => {
  const o = craft(0x00);
  oracle(o);
  assert.equal(o.mem8[loc_8819], 0x00, "scratch cleared");
  assert.equal(o.mem8[GAME_ACTIVE_FLAG], 0x00, "in-play flag dropped");
  assert.equal(o.mem.read16(TILE_FILL_PTR), PLAYFIELD_PAINT_START, "fill cursor seated at paint origin");
  assert.equal(o.mem8[FILL_ROW_COUNTER], 0x0f, "row counter primed");
  assert.equal(o.mem8[PLAY_STATE_INDEX], 0x01, "sub-state advanced 0 -> 1");
  console.log("  WRITE-SET: cursor/counter/flags seated, sub-state -> 1");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  primeTileFillCursorAndAdvanceBoardBuild(c);
  c.mem8[FILL_ROW_COUNTER] = (o.mem8[FILL_ROW_COUNTER] ^ 0xff) & 0xff;
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, FILL_ROW_COUNTER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the sub-state bump diverges from the oracle", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  primeTileFillCursorAndAdvanceBoardBuild(c);
  c.mem8[PLAY_STATE_INDEX] = 0x00; // regress the bump the handler performed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped sub-state bump must be caught");
  assert.equal(d.addr, PLAY_STATE_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(bump): caught at ${hx(d.addr)}`);
});
