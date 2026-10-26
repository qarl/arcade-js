// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for queueCreditDisplayAndEnterBoardBuild (ROM 0x0d61, Pooyan) — the coin jingle.
 *
 * On a nonzero credit count (0x8802) it queues a credit display command (rst 0x38) — 0x0618 for
 * exactly one credit, 0x0619 for more — then a fixed 0x0300 command, and sets the top-level game
 * state (0x8805) to 2. A zero credit count returns having done nothing.
 *
 * Cycle-free memory-equivalence: a fresh clone per side, RAM (dumpState) minus stack scratch below the entry SP.
 * No register live-out. SP parked in dead stack scratch.
 *
 * Jobs:
 *   1. EQUAL — zero credits, one credit, two credits: module == oracle (RAM −stack).
 *   2. WRITE-SET — a nonzero count sets 0x8805 = 2 and enqueues two commands; zero is inert.
 *   3. TEETH — a corrupted 0x8805 byte and a twin that skips the state write are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0d61.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0d61 as oracle } from "../../translated/loc_0cf8.js";
import { queueCreditDisplayAndEnterBoardBuild } from "../queueCreditDisplayAndEnterBoardBuild.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const CREDIT_COUNT = 0x8802;
const MAIN_GAME_STATE = 0x8805;
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

function craft(credits) {
  const m = BASE.clone();
  m.mem.write8(CREDIT_COUNT, credits & 0xff);
  m.mem.write8(MAIN_GAME_STATE, 0xaa); // pre-dirty so the write (or its absence) is observable
  m.mem.write8(RING_WRITE_PTR, RING_START);
  for (let c = RING_START; c <= 0xff; c++) m.mem.write8(RING_PAGE + c, 0x80); // all slots free
  m.regs.sp = SP0;
  return m;
}

const CASES = { "zero credits": 0x00, "one credit": 0x01, "two credits": 0x02 };

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: queueCreditDisplayAndEnterBoardBuild == oracle in RAM (−stack)", () => {
  for (const [name, credits] of Object.entries(CASES)) {
    const o = craft(credits);
    const c = craft(credits);
    oracle(o);
    queueCreditDisplayAndEnterBoardBuild(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: zero/one/two-credit paths identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a nonzero count sets 0x8805=2; a zero count is inert", () => {
  const one = craft(0x01);
  oracle(one);
  assert.equal(one.mem.read8(MAIN_GAME_STATE), 0x02, "one credit -> state 2");

  const zero = craft(0x00);
  const before = zero.dumpState();
  oracle(zero);
  assert.deepEqual([...zero.dumpState()], [...before], "zero credits must leave RAM untouched");
  console.log("  WRITE-SET: nonzero -> state 2; zero inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted 0x8805 byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x02);
  const c = craft(0x02);
  oracle(o);
  queueCreditDisplayAndEnterBoardBuild(c);
  c.mem.write8(MAIN_GAME_STATE, (o.mem.read8(MAIN_GAME_STATE) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted state byte");
  assert.equal(d.addr, MAIN_GAME_STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the state write diverges from the oracle", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o); // sets state = 2
  // twin: do nothing -> the pre-dirty 0xaa survives at 0x8805
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped state write must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
