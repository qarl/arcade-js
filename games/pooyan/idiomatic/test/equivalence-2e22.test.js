// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for driveActiveRopeCells (ROM 0x2e22, Pooyan) — the rope-cell driver. It reads the
 * active-cell count, returns at once when it is zero, and otherwise walks the per-cell state array
 * one byte per step, handing each cell record to the rope-cell dispatcher.
 *
 * SEATING: seats a per-cell return slot — the loop pushes a return address before each dispatcher
 * call, which the dispatcher's ret consumes, so SP nets 0 per cell (net 0 overall). WIRE.
 * The oracle drives the dispatcher through the routines map; the module calls the idiomatic
 * dispatcher directly. driveActiveRopeCells is a void driver — no register survives, so the register file is
 * not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP. SP is parked in STACK_SCRATCH
 * so the nested dispatch pushes drop out of the diff.
 *
 * Cases are CRAFTED. An inactive cell (state 0) makes the dispatcher return immediately, so the
 * loop is exercised with no writes; an active cell (state 1) with the shared gate open and its
 * per-cell timer still running decrements exactly that timer, an isolated deterministic write.
 *
 * Jobs:
 *   1. EQUAL — zero count (inert), three inactive cells (loop runs, no writes), one active cell
 *      (one timer decrement), two active cells (two timer decrements): oracle == module in RAM.
 *   2. WRITE-SET — a zero count leaves RAM untouched; an active cell decrements its timer.
 *   3. TEETH — a wrong byte is caught by the RAM diff; a count poked down by one drops the last
 *      cell's timer write, proving the count drives the loop.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2e22.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2e22 as oracle } from "../../translated/loc_2e22.js";
import { driveActiveRopeCells } from "../driveActiveRopeCells.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const COUNT = 0x8f18; //  ROPE_EXTEND_INDEX — active-cell count
const STATE = 0x8f1c; //  ROPE_CELL_STATE_BASE — one state byte per cell
const TIMERS = 0x8f28; // per-cell frame timers (2 bytes apart)
const GATE = 0x8a5f; //   handler gate; &3 == 0 opens the timer branch
const SP0 = 0x8ff0; //    inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the count + cell array. Active cells get state 1 (handler 0) and a running timer. */
function seat(m, { count = 0, active = [] } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(COUNT, count);
  m.mem.write8(GATE, 0x00); // gate open
  for (let i = 0; i < 4; i++) m.mem.write8(STATE + i, 0x00); // all cells inactive
  for (const cell of active) {
    m.mem.write8(STATE + cell, 0x01); // active -> dispatch handler 0
    m.mem.write8(TIMERS + 2 * cell, 0x05); // timer running -> single decrement, then return
  }
  return m;
}

const craftEmpty = () => seat(BASE.clone(), { count: 0 });
const craftInactive = () => seat(BASE.clone(), { count: 3 });
const craftActive1 = () => seat(BASE.clone(), { count: 1, active: [0] });
const craftActive2 = () => seat(BASE.clone(), { count: 2, active: [0, 1] });

const CASES = [
  { name: "zero count -> inert", craft: craftEmpty },
  { name: "three inactive cells -> loop, no writes", craft: craftInactive },
  { name: "one active cell -> one timer decrement", craft: craftActive1 },
  { name: "two active cells -> two timer decrements", craft: craftActive2 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: driveActiveRopeCells == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    driveActiveRopeCells(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a zero count is inert; an active cell decrements its timer", () => {
  const empty = craftEmpty();
  const b0 = empty.dumpState();
  oracle(empty);
  assert.deepEqual([...empty.dumpState()], [...b0], "a zero count must leave RAM untouched");

  const one = craftActive1();
  assert.equal(one.mem.read8(TIMERS), 0x05, "precondition: timer seeded to 5");
  oracle(one);
  assert.equal(one.mem.read8(TIMERS), 0x04, "an active cell decrements its per-cell timer");
  console.log("  WRITE-SET: empty inert; active decrements timer");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftActive2();
  const c = craftActive2();
  oracle(o);
  driveActiveRopeCells(c);
  c.mem.write8(TIMERS + 2, (o.mem.read8(TIMERS + 2) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted timer byte");
  assert.equal(d.addr, TIMERS + 2, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a count poked down by one drops the last cell's timer write", () => {
  const full = craftActive2();
  const under = craftActive2();
  under.mem.write8(COUNT, 0x01); // process only the first cell
  oracle(full);
  oracle(under);
  // COUNT is a read-only input knob; normalize it post-run so the diff isolates the EFFECT (the
  // per-cell timer writes) instead of surfacing at COUNT (0x8f18), which sorts before TIMERS+2.
  under.mem.write8(COUNT, full.mem.read8(COUNT));
  const d = ramDiffMinusStack(full, under);
  assert.notEqual(d, null, "the count must drive the loop — undercount produced identical RAM");
  assert.equal(d.addr, TIMERS + 2, `count teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(count): undercount diverges at ${hx(d.addr)}`);
});
