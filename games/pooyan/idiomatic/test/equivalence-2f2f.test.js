// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for retractRopeSegment (ROM 0x2f2f, Pooyan) — the rope-cell state-4 handler: on the
 * per-cell timer, while rope segments remain, it selects a retract-anim pointer, reads this
 * segment's attribute, merges it into the timer cell, clears a formation record, advances the cell
 * state, and blits the segment tile.
 *
 * The module dissolves every callee (2e45/0c45/0020/0010/2e52/3325) to a direct idiomatic call; the
 * oracle drives the same frozen callees through the routines map. retractRopeSegment is a void handler — no
 * register survives to a caller (the rope-cell driver reads none back) — so the register file is not
 * compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack so the
 * oracle's nested dispatch pushes drop out of the diff.
 *
 * Two crafted cells: cell 0's timer is the terminal 0x28 column (paired-cell merge skipped) and
 * cell 1's timer is a non-terminal column (paired-cell bits merged in). Both have their timer at 1
 * so the tick expires this frame, and rope segments remaining, so the full retract path runs.
 *
 * Jobs:
 *   1. EQUAL — terminal + merge cells: oracle == retractRopeSegment in RAM (−stack).
 *   2. WRITE-SET — the handler advances the cell state to 1 and clears the selected formation record.
 *   3. TEETH — a wrong cell-state byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2f2f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2f2f as oracle } from "../../translated/loc_2f2f.js";
import { retractRopeSegment } from "../retractRopeSegment.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CELL_BASE = 0x8f1c; //   ROPE_CELL_STATE_BASE; IX = CELL_BASE + cell index
const TIMERS = 0x8f28; //      ROPE_CELL_TIMERS; per-cell timer, stride 2 by IXL&3
const SEG_COUNT = 0x8931; //   ROPE_SEGMENT_COUNT
const ROUND = 0x8907; //       ROUND_COUNTER
const DIFF = 0x8820; //        DIFFICULTY_DSW
const FORMATION = 0x8c48; //   FORMATION_TABLE + 0x18 (formation index 0 -> slot 1)
const SP0 = 0x8ff0; //         inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with one rope cell about to retract. `cell` selects the timer (IXL&3). */
function craft(cell) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = CELL_BASE + cell;
  const timer = TIMERS + 2 * cell;
  m.mem8[timer] = 0x01; //               timer at 1 -> ticks to 0 this frame (expires)
  m.mem8[timer + 1] = 0x00; //           formation index 0 -> clears slot 1
  if (cell !== 0) m.mem8[timer - 2] = 0x1c; // paired-cell source bits (merge path only)
  m.mem8[SEG_COUNT] = 0x03; //           segments remain
  m.mem8[ROUND] = 0x04; //               round>>2 = 1 -> anim row 1
  m.mem8[DIFF] = 0x00;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: terminal + merge cells — retractRopeSegment == oracle in RAM (−stack)", () => {
  for (const [label, cell] of [["terminal (0x28 col)", 0], ["merge (non-terminal col)", 1]]) {
    const o = craft(cell);
    oracle(o);
    const c = craft(cell);
    retractRopeSegment(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: terminal + merge cells identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the handler advances the cell state and clears the formation record", () => {
  const m = craft(0);
  for (let i = 0; i < 0x18; i++) m.mem8[FORMATION + i] = 0xaa; // dirty the record first
  oracle(m);
  assert.equal(m.mem8[CELL_BASE], 0x01, "cell state advanced to 1");
  for (let i = 0; i < 0x18; i++) {
    assert.equal(m.mem8[FORMATION + i], 0x00, `formation record byte +${i} cleared`);
  }
  console.log("  WRITE-SET: cell state = 1, formation record cleared");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cell-state byte is CAUGHT by the RAM diff", () => {
  const o = craft(0);
  const c = craft(0);
  oracle(o);
  retractRopeSegment(c);
  c.mem8[CELL_BASE] = 0x00; // BUG: the handler must have advanced the cell state to 1
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cell-state byte — it is worthless");
  assert.equal(d.addr, CELL_BASE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong cell-state byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
