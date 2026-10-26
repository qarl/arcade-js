// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for fillIntroRowsThenBuildBoardIntro (ROM 0x0c77, Pooyan) — board-intro state 1.
 *
 * Each call fills two 0x1d-byte tile runs (fillByteRun) from the fill cursor and ticks the row
 * countdown (0x8809). While the countdown holds it returns. When it drains it advances the play
 * sub-state (0x880a) and runs the one-shot intro build: a ROM checksum guard, the attribute-column
 * flood (loc_075d, leftover A -> 0x880d), the credit display commands (loc_0e54), the two-plane
 * column stamp (stampTwoPlaneColumnStrip), a run of rst-0x38 display commands whose 1P/2P variants come from the
 * bonus DSW bit (0x8800 bit0), and two sound commands (loc_0f4e).
 *
 * Cycle-free memory-equivalence: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). No register live-out — a frame-interrupt state handler, register file
 * saved/restored around it, so only memory survives. SP parked in dead stack scratch.
 *
 * Jobs:
 *   1. EQUAL — countdown-holds, drains (DSW bit0=0), drains (DSW bit0=1): module == oracle (RAM −stack).
 *   2. WRITE-SET — a hold decrements the counter and fills; a drain advances the sub-state and
 *      stores the leftover A (0x1f) at 0x880d.
 *   3. TEETH — a corrupted fill byte and a corrupted 0x880d byte are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0c77.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0c77 as oracle } from "../../translated/loc_0c45.js";
import { fillIntroRowsThenBuildBoardIntro } from "../fillIntroRowsThenBuildBoardIntro.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TILE_FILL_PTR = 0x880b;
const FILL_ROW_COUNTER = 0x8809;
const PLAY_STATE_INDEX = 0x880a;
const ACTIVE_PLAYER = 0x880d;
const BONUS_AWARD_DSW = 0x8800;
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

/** A fresh clone with the fill cursor, row counter, DSW bit, a freed display ring, pre-dirtied cells. */
function craft(cursor, rowCount, dsw) {
  const m = BASE.clone();
  m.mem.write16(TILE_FILL_PTR, cursor & 0xffff);
  m.mem.write8(FILL_ROW_COUNTER, rowCount & 0xff);
  m.mem.write8(BONUS_AWARD_DSW, dsw & 0xff);
  m.mem.write8(PLAY_STATE_INDEX, 0xaa); // pre-dirty so an increment (or its absence) is observable
  m.mem.write8(ACTIVE_PLAYER, 0xaa);
  m.mem.write8(RING_WRITE_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  m.regs.sp = SP0;
  return m;
}

const CASES = {
  "countdown holds": () => craft(0x8402, 0x05, 0x00),
  "drains, DSW bit0=0": () => craft(0x8402, 0x01, 0x00),
  "drains, DSW bit0=1": () => craft(0x8402, 0x01, 0x01),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: fillIntroRowsThenBuildBoardIntro == oracle in RAM (−stack)", () => {
  for (const [name, mk] of Object.entries(CASES)) {
    const o = mk();
    const c = mk();
    oracle(o);
    fillIntroRowsThenBuildBoardIntro(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hold decrements the counter and fills; a drain advances the sub-state", () => {
  const hold = CASES["countdown holds"]();
  oracle(hold);
  assert.equal(hold.mem.read8(FILL_ROW_COUNTER), 0x04, "0x05 - 1 = 0x04 counter after a hold");
  assert.equal(hold.mem.read8(0x8402), 0x10, "first fill run stamped tile 0x10");
  assert.equal(hold.mem.read8(PLAY_STATE_INDEX), 0xaa, "sub-state untouched while the countdown holds");

  const drain = CASES["drains, DSW bit0=0"]();
  oracle(drain);
  assert.equal(drain.mem.read8(FILL_ROW_COUNTER), 0x00, "counter drained to 0");
  assert.equal(drain.mem.read8(PLAY_STATE_INDEX), 0xab, "0xaa + 1 = 0xab sub-state after a drain");
  assert.equal(drain.mem.read8(ACTIVE_PLAYER), 0x1f, "leftover A (0x1f) from the attribute flood stored at 0x880d");
  console.log("  WRITE-SET: hold counter -1; drain sub-state +1, A=0x1f stored");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted fill byte is CAUGHT by the RAM diff", () => {
  const o = CASES["countdown holds"]();
  const c = CASES["countdown holds"]();
  oracle(o);
  fillIntroRowsThenBuildBoardIntro(c);
  c.mem.write8(0x8402, (o.mem.read8(0x8402) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted fill byte");
  assert.equal(d.addr, 0x8402, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(fill): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the sub-state advance diverges from the oracle", () => {
  const o = CASES["drains, DSW bit0=0"]();
  const c = CASES["drains, DSW bit0=0"]();
  oracle(o);
  fillIntroRowsThenBuildBoardIntro(c);
  c.mem.write8(ACTIVE_PLAYER, (o.mem.read8(ACTIVE_PLAYER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a corrupted 0x880d byte must be caught by the RAM diff");
  console.log(`  TEETH(0x880d): caught at ${hx(d.addr ?? 0)}`);
});
