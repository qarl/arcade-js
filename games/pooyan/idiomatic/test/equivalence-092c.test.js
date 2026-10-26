// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for paintAttractColorsAndQueueDraws (Pooyan) — attract sub-state 2: a frame-gated tilemap
 * clear that, once drained, advances the attract sub-state, zeroes the board-init RAM, runs the
 * anti-tamper checks, and queues the attract display.
 *
 * paintAttractColorsAndQueueDraws is a void handler — no register survives — so the register file is not compared;
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack so nested pushes
 * drop out. The two crafted states seat the frame gate on its two arms: drained (row counter
 * hits zero -> the full body runs) and still-counting (one tick -> early return).
 *
 * Jobs:
 *   1. EQUAL — drained and counting arms: oracle == paintAttractColorsAndQueueDraws in RAM (−stack).
 *   2. WRITE-SET — the row gate gates the sub-state advance: drained bumps ATTRACT_SUBSTATE,
 *      counting holds it.
 *   3. TEETH — a wrong sub-state byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-092c.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_092c as oracle } from "../../translated/loc_092c.js";
import { paintAttractColorsAndQueueDraws } from "../paintAttractColorsAndQueueDraws.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FILL_ROW_COUNTER = 0x8809; // decremented each frame; Z (drained) opens the full body
const TILE_FILL_PTR = 0x880b; //    16-bit tilemap fill cursor
const ATTRACT_SUBSTATE = 0x8e51; //  bumped once per drained frame
const PLAYFIELD = 0x8402; //        a valid tilemap start for the fill cursor
const SP0 = 0x8ff0; //              inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the frame gate seated at `rows` and a valid fill cursor. */
function craft(rows) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[FILL_ROW_COUNTER] = rows & 0xff;
  m.mem.write16(TILE_FILL_PTR, PLAYFIELD);
  m.mem8[ATTRACT_SUBSTATE] = 0x02;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: drained + counting arms — paintAttractColorsAndQueueDraws == oracle in RAM (−stack)", () => {
  for (const [label, rows] of [["drained (rows=1)", 0x01], ["counting (rows=2)", 0x02]]) {
    const o = craft(rows);
    oracle(o);
    const c = craft(rows);
    paintAttractColorsAndQueueDraws(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: drained + counting identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the row gate gates the sub-state advance", () => {
  const drained = craft(0x01);
  oracle(drained);
  assert.equal(drained.mem8[ATTRACT_SUBSTATE], 0x03, "drained -> sub-state advanced");

  const counting = craft(0x02);
  oracle(counting);
  assert.equal(counting.mem8[ATTRACT_SUBSTATE], 0x02, "counting -> sub-state held");

  assert.notEqual(drained.mem8[ATTRACT_SUBSTATE], counting.mem8[ATTRACT_SUBSTATE],
    "the row gate must gate the sub-state advance");
  console.log("  WRITE-SET: drained bumps the sub-state, counting holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong sub-state byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  paintAttractColorsAndQueueDraws(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: drained arm must match before the poke");
  c.mem8[ATTRACT_SUBSTATE] = 0x02; // BUG: the drained pass must have advanced it to 0x03
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong sub-state byte — it is worthless");
  assert.equal(d.addr, ATTRACT_SUBSTATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong sub-state byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
