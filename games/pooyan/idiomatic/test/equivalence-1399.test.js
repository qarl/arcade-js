// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchActorSpawnBySubStateAndPaceCadence (ROM 0x1399, Pooyan) — actor sub-state dispatch on rec+6.
 *
 * SEATING: BALANCED (plain ret / tail-calls) -> WIRE. Reached via latchActorStepThenDispatchByStageCountdown's tail from the actor
 * dispatch; the sub-state handlers are void, so LIVE-OUT is memory only and the comparison is RAM
 * (dumpState) minus stack scratch below the entry SP; register file not compared. SP parked in STACK_SCRATCH.
 *
 * The module drives idiomatic siblings directly; the oracle drives the translated siblings through the
 * routines map (each pair has its own gate). Crafted paths: state < 7 (spawn-step guard), state >= 0x14
 * (field-compare dispatch), and the 7..0x13 timer body — timer running (decrement), timer spent with the
 * count exhausted (inert), and timer spent below the count (table reload + child spawn). The spawn slots
 * are seated full so the child-spawn tail returns without writing, isolating dispatchActorSpawnBySubStateAndPaceCadence's own footprint.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a running timer decrements; a spent timer below the count reloads from the table.
 *   3. TEETH — a corrupted post-run byte is caught by the RAM diff; a wrong-branch twin diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1399.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1399 as oracle } from "../../translated/loc_1399.js";
import { dispatchActorSpawnBySubStateAndPaceCadence } from "../dispatchActorSpawnBySubStateAndPaceCadence.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c50; // IX record base
const TIMER = 0x8d6b; // SPAWN_STEP_TIMER
const ROUND = 0x8907; // ROUND_COUNTER
const SPRITES = 0x8b70; // SPRITE_OBJECT_TABLE
const STRIDE = 0x18;
const RELOAD_TABLE = 0x13d3; // STATE_TIMER_RELOAD_TABLE (ROM)
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the IX record, the count register, the timer/round cells, and full spawn slots. */
function seat(m, { state = 0x10, flag = 0x00, timer = 0x05, count = 0x00, round = 0x03 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.ix = REC;
  m.regs.b = count;
  for (let i = 0; i < 0x18; i++) m.mem.write8(REC + i, 0x00);
  m.mem.write8(REC + 0x06, state); // sub-state selector
  m.mem.write8(REC + 0x08, flag); //  spawn/handled flag read by the guards
  m.mem.write8(TIMER, timer);
  m.mem.write8(ROUND, round);
  for (let i = 0; i < 5; i++) {
    m.mem.write8(SPRITES + i * STRIDE + 0, 0x01); // bit0 set -> slot occupied
    m.mem.write8(SPRITES + i * STRIDE + 1, 0x00);
  }
  return m;
}

const CASES = {
  "state<7 -> spawn-step guard (inert)": (m) => seat(m, { state: 0x03, flag: 0x00 }),
  "state>=0x14 -> field-compare (inert)": (m) => seat(m, { state: 0x20, flag: 0x01 }),
  "timer running -> decrement": (m) => seat(m, { state: 0x10, timer: 0x05 }),
  "timer spent, count exhausted -> inert": (m) => seat(m, { state: 0x10, timer: 0x00, count: 0x80 }),
  "timer spent, below count -> reload+spawn": (m) => seat(m, { state: 0x10, timer: 0x00, count: 0x00 }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchActorSpawnBySubStateAndPaceCadence == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    dispatchActorSpawnBySubStateAndPaceCadence(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a running timer decrements; a spent timer below the count reloads from the table", () => {
  const run = CASES["timer running -> decrement"](BASE.clone());
  oracle(run);
  assert.equal(run.mem.read8(TIMER), 0x04, "0x05 - 1 = 0x04");

  const reload = CASES["timer spent, below count -> reload+spawn"](BASE.clone());
  const expected = reload.mem.read8((RELOAD_TABLE + (reload.mem.read8(ROUND) & 0x07)) & 0xffff);
  oracle(reload);
  assert.equal(reload.mem.read8(TIMER), expected, "timer reloaded from the per-round table byte");
  console.log("  WRITE-SET: timer decrement + table reload");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const o = CASES["timer running -> decrement"](BASE.clone());
  const c = CASES["timer running -> decrement"](BASE.clone());
  oracle(o);
  dispatchActorSpawnBySubStateAndPaceCadence(c);
  c.mem.write8(TIMER, (o.mem.read8(TIMER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong-branch twin (timer body on a state<7 record) diverges", () => {
  const o = CASES["state<7 -> spawn-step guard (inert)"](BASE.clone());
  const c = CASES["state<7 -> spawn-step guard (inert)"](BASE.clone());
  oracle(o); // guard path: leaves the timer untouched
  c.mem.write8(TIMER, (c.mem.read8(TIMER) - 1) & 0xff); // twin ran the timer body instead
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "running the timer body on a state<7 record must diverge");
  assert.equal(d.addr, TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(branch): caught at ${hx(d.addr)}`);
});
