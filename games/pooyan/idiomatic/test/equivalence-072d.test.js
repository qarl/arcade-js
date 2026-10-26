// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for blankFillRowThenFinishAttractSetup (ROM 0x072d, Pooyan) — the attract state-0 handler.
 * It blanks one row of the row-by-row tilemap fill (blankFillRowAndStepCounter). While rows remain it returns.
 * Once the fill drains it reads the boot self-test tally at 0x8fff: if != 0x10 it hands off to
 * the main loop (a non-returning `jp`); if == 0x10 it finishes the attract-to-play setup —
 * clears the in-play flag (0x8806), advances the top-level state (0x8805:=1), resets the play
 * sub-state (0x880a:=0), floods the colour/attribute map from source 0x0779 (loc_075d), enqueues
 * three display commands (rst 0x38: 0x0604, 0x0500, 0x0502), and clears the attract sub-state
 * (0x8e51).
 *
 * Cycle-free memory-equivalence gate: a fresh clone per side, compared on RAM (dumpState, minus
 * stack scratch below the entry SP). No register live-out — this runs inside the frame interrupt, whose register
 * file is saved/restored around it, so only memory survives.
 *
 * Inputs poked identically on both sides: the fill cursor + row counter (blankFillRowAndStepCounter's inputs), the
 * self-test tally, the display-command ring (write pointer + free slots, so the three commands
 * actually enqueue and a dropped/mis-valued command is caught), and the four state cells
 * pre-dirtied so writing them (some to zero) is observable.
 *
 * The `jp 0x020f` branch (tally != 0x10) is NOT run against the oracle — the oracle enters the
 * infinite main loop there — so it is covered by a module-only arm asserting the finish-block
 * cells are left untouched.
 *
 * Jobs:
 *   1. EQUAL — the early-return (rows remain) and the finish (tally passed) paths: module ==
 *      oracle in RAM (−stack).
 *   2. WRITE-SET — the finish path sets the four state cells to their values, floods the
 *      attribute column from the source byte, and advances the ring write pointer.
 *   3. BRANCH (module-only) — tally != 0x10 leaves the finish-block cells untouched.
 *   4. TEETH — a wrong state byte and a wrong attribute byte are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-072d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_072d as oracle } from "../../translated/loc_072d.js";
import { blankFillRowThenFinishAttractSetup } from "../blankFillRowThenFinishAttractSetup.js";
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
const BOOT_SELFTEST_TALLY = 0x8fff;
const GAME_ACTIVE_FLAG = 0x8806;
const MAIN_GAME_STATE = 0x8805;
const PLAY_STATE_INDEX = 0x880a;
const ATTRACT_SUBSTATE = 0x8e51;
const ATTRIB_MAP_BASE = 0x8040;
const ATTRIB_SRC = 0x0779;
const SELFTEST_PASSED = 0x10;

// Display-command ring on page 0x88: write pointer + slots (a slot is free when bit 7 is set).
const RING_WRITE_PTR = 0x88a0;
const RING_PAGE = 0x8800;
const RING_START = 0xc0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the fill inputs, the self-test tally, a freed ring, and pre-dirtied state cells. */
function craft(cursor, rowCount, tally) {
  const m = BASE.clone();
  m.mem.write16(TILE_FILL_PTR, cursor & 0xffff);
  m.mem.write8(FILL_ROW_COUNTER, rowCount & 0xff);
  m.mem.write8(BOOT_SELFTEST_TALLY, tally & 0xff);
  m.mem.write8(RING_WRITE_PTR, RING_START); // ring cursor at the start slot
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  for (const cell of [GAME_ACTIVE_FLAG, MAIN_GAME_STATE, PLAY_STATE_INDEX, ATTRACT_SUBSTATE]) {
    m.mem.write8(cell, 0xaa); // pre-dirty so a to-zero write (or a missing write) is observable
  }
  m.regs.sp = 0x8ff0; // dead-stack scratch below the tally cell; nested push/ret stay in STACK_SCRATCH
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early-return (rows remain) and finish (tally passed) — blankFillRowThenFinishAttractSetup == oracle in RAM (−stack)", () => {
  const cases = [
    { name: "rows remain -> early return", cursor: 0x8402, rowCount: 0x05, tally: SELFTEST_PASSED },
    { name: "fill drains, tally passed -> finish setup", cursor: 0x8402, rowCount: 0x01, tally: SELFTEST_PASSED },
  ];
  for (const { name, cursor, rowCount, tally } of cases) {
    const o = craft(cursor, rowCount, tally);
    const c = craft(cursor, rowCount, tally);
    oracle(o);
    blankFillRowThenFinishAttractSetup(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: early-return + finish paths identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the finish path sets the state cells, floods the attribute column, advances the ring", () => {
  const m = craft(0x8402, 0x01, SELFTEST_PASSED);
  oracle(m);

  assert.equal(m.mem.read8(GAME_ACTIVE_FLAG), 0x00, "in-play flag cleared");
  assert.equal(m.mem.read8(MAIN_GAME_STATE), 0x01, "top-level state advanced to 1");
  assert.equal(m.mem.read8(PLAY_STATE_INDEX), 0x00, "play sub-state reset");
  assert.equal(m.mem.read8(ATTRACT_SUBSTATE), 0x00, "attract sub-state cleared");

  const srcByte = m.mem.read8(ATTRIB_SRC); // column 0's flooded value comes from the source table
  assert.equal(m.mem.read8(ATTRIB_MAP_BASE), srcByte, "attribute column 0 row 0 flooded from the source");
  assert.equal(m.mem.read8(ATTRIB_MAP_BASE + 0x20), srcByte, "attribute column 0 row 1 flooded from the source");

  assert.notEqual(m.mem.read8(RING_WRITE_PTR), RING_START, "ring write pointer advanced by the enqueues");
  assert.equal(m.mem.read8(RING_PAGE + RING_START), 0x06, "first command's high byte enqueued");
  console.log("  WRITE-SET: state cells set, attribute column flooded, ring advanced");
});

// -- 3. BRANCH (module-only) --------------------------------------------------

test("BRANCH: tally != 0x10 abandons setup (finish-block cells untouched) — module only", () => {
  // The oracle jumps into the infinite main loop on this branch, so it cannot be run here; this
  // arm confirms the module takes the early exit and writes none of the finish-block cells.
  const c = craft(0x8402, 0x01, 0x00); // fill drains, tally NOT passed
  blankFillRowThenFinishAttractSetup(c);
  for (const cell of [GAME_ACTIVE_FLAG, MAIN_GAME_STATE, PLAY_STATE_INDEX, ATTRACT_SUBSTATE]) {
    assert.equal(c.mem.read8(cell), 0xaa, `finish-block cell ${hx(cell)} must be untouched on the abandon path`);
  }
  console.log("  BRANCH: tally mismatch left the four finish-block cells at their seeded value");
});

// -- 4. TEETH -----------------------------------------------------------------

test("TEETH: a wrong state byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x8402, 0x01, SELFTEST_PASSED);
  const c = craft(0x8402, 0x01, SELFTEST_PASSED);
  oracle(o);
  blankFillRowThenFinishAttractSetup(c);
  c.mem.write8(MAIN_GAME_STATE, 0x02); // BUG: state must advance to exactly 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong state byte — it is worthless");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(state): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong attribute byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x8402, 0x01, SELFTEST_PASSED);
  const c = craft(0x8402, 0x01, SELFTEST_PASSED);
  oracle(o);
  blankFillRowThenFinishAttractSetup(c);
  c.mem.write8(ATTRIB_MAP_BASE, (c.mem.read8(ATTRIB_MAP_BASE) ^ 0xff) & 0xff); // BUG: corrupt a flooded cell
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong attribute byte — it is worthless");
  assert.equal(d.addr, ATTRIB_MAP_BASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(attribute): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
