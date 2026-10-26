// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for buildAttractSpritesAndPrimeTextScript (ROM 0x099c, Pooyan) — the attract sub-state 4 handler.
 *
 * Every callee is lifted and dissolved to a direct call, so the module holds no emulated stack op;
 * the oracle drives the same work through push16/call/ret in STACK_SCRATCH. Equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP. There is no register live-out — the handler is dispatched by
 * jp (hl) and falls into the void advanceFourObjectAnimsAndRebuildList — so the register file is not compared.
 *
 * The full path reads two redundant ROM tables that MUST match on an intact ROM (the byte pairs at
 * 0x07c9/0x0a65 are byte-identical, verified against maincpu.bin) so the spin-verify terminates, and
 * the object-build loop hits its 0xff descriptor sentinel after four records — both bounded.
 *
 * Jobs:
 *   1. EQUAL — early path (row counter not drained -> return after the row fill) and full path
 *      (drained -> verify + fills + build + script block + fall into advanceFourObjectAnimsAndRebuildList): oracle == buildAttractSpritesAndPrimeTextScript.
 *   2. WRITE-SET — the full path seats the script block (read/write pointers, timer, sub-state++,
 *      the two check-tick bytes); the early path leaves them untouched.
 *   3. TEETH — a wrong script byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-099c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_099c as oracle } from "../../translated/loc_099c.js";
import { buildAttractSpritesAndPrimeTextScript } from "../buildAttractSpritesAndPrimeTextScript.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FILL_ROW_COUNTER = 0x8809; // blankFillRowAndStepCounter decrements it; 0 -> drained -> full path
const TILE_FILL_PTR = 0x880b; //    16-bit row-fill cursor blankFillRowAndStepCounter advances
const SCRIPT_FRAME_TIMER = 0x8e50;
const ATTRACT_SUBSTATE = 0x8e51;
const SCRIPT_ROW_CHECK = 0x8e52;
const SCRIPT_COL_CHECK = 0x8e53;
const SCRIPT_READ_PTR = 0x8e54; // 16-bit
const SCRIPT_WRITE_PTR = 0x8e56; // 16-bit
const SP0 = 0x8ff0; //             inside STACK_SCRATCH: the oracle's nested calls stay in dead scratch

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** rows: FILL_ROW_COUNTER seed (1 -> drains to 0 -> full path; >1 -> early return). */
function craft(rows) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[FILL_ROW_COUNTER] = rows & 0xff;
  m.mem.write16(TILE_FILL_PTR, 0x8400); // a tile-RAM cursor for the per-frame row fill
  m.mem8[ATTRACT_SUBSTATE] = 0x04; // sub-state 4 -> full path advances it to 5
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early + full path — buildAttractSpritesAndPrimeTextScript == oracle in RAM (−stack)", () => {
  for (const [label, rows] of [["full path (drained)", 0x01], ["early (rows remain)", 0x05]]) {
    const o = craft(rows);
    oracle(o);
    const c = craft(rows);
    buildAttractSpritesAndPrimeTextScript(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: early + full path identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full path seats the text-draw script block", () => {
  const full = craft(0x01);
  oracle(full);
  assert.equal(full.mem.read16(SCRIPT_READ_PTR), 0x0a87, "script read pointer seated");
  assert.equal(full.mem.read16(SCRIPT_WRITE_PTR), 0x8648, "script VRAM write cursor seated");
  assert.equal(full.mem8[SCRIPT_FRAME_TIMER], 0x32, "frame timer seeded");
  assert.equal(full.mem8[ATTRACT_SUBSTATE], 0x05, "sub-state advanced 4 -> 5");
  assert.equal(full.mem8[SCRIPT_ROW_CHECK], 0x0d, "row-check tick seeded");
  assert.equal(full.mem8[SCRIPT_COL_CHECK], 0x05, "column-check tick seeded");

  const early = craft(0x05);
  oracle(early);
  assert.equal(early.mem8[SCRIPT_FRAME_TIMER], 0x00, "early path leaves the script block untouched");
  assert.notEqual(full.mem8[ATTRACT_SUBSTATE], early.mem8[ATTRACT_SUBSTATE], "full path must advance the sub-state");
  console.log("  WRITE-SET: full path seats the script block; early path does not");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong script byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  buildAttractSpritesAndPrimeTextScript(c);
  c.mem8[SCRIPT_FRAME_TIMER] = 0x00; // BUG: the full path must have seeded it to 0x32
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong script byte — it is worthless");
  assert.equal(d.addr, SCRIPT_FRAME_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong script byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
