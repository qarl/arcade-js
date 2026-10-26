// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for decrementPhaseCounterAndDispatchSpawnOrStep (ROM 0x57c3, Pooyan) — the sub-state head.
 *
 * `dec b` splits the entry: a counter that reaches 0 (was 1) hands off to the spawn-or-step entry
 * (spawnSpecialActorElseStep), every other value to the animation-advance stepper (advanceEagleStageTimersAndLatchMoveElseRearm). Both are tail hand-offs
 * reusing the caller's frame; the decremented counter is threaded through the register bridge so a
 * delegate that returns without rewriting B leaves the oracle's value behind. The whole subtree runs
 * on both sides from an identical clone.
 *
 * SEATING: TAIL-CALL — the seating is the delegate's. Compared on RAM (dumpState) minus stack scratch below the entry SP;
 * B is additionally compared where the delegate leaves it untouched, since B is the routine's only
 * register effect. Cases are CRAFTED. Green once the batch cluster (spawnSpecialActorElseStep / advanceEagleStageTimersAndLatchMoveElseRearm /
 * verifyTableChecksum) is present.
 *
 * Jobs:
 *   1. EQUAL — a b != 1 stepper path and a b == 1 spawn path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — the stepper footprint and the spawn footprint at their exact values.
 *   3. TEETH — a non-decremented B is caught by the register compare; the two branches produce
 *      different RAM (the dispatch is load-bearing) and a wrong stepper field is caught by the diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-57c3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_57c3 as oracle } from "../../translated/loc_57c3.js";
import { decrementPhaseCounterAndDispatchSpawnOrStep } from "../decrementPhaseCounterAndDispatchSpawnOrStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; //          actor record (IX)
const ACTIVE_FLAG = 0x8d4a; //  singleton-actor active flag
const STEP_COUNTER = 0x8d46; // sub-state step counter
const STAGE_TIMERS = 0x8d47; // three stage timers 0x8d47..0x8d49
const TAMPER = 0x882b; //       checksum tripwire (stays 0 on the genuine ROM)
const SP0 = 0x8fe0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat IX + SP and clear the sub-state world; overrides seed the specific path. */
function seat(m, count, { active = 0, counter = 0, timers = [0, 0, 0] } = {}) {
  m.regs.ix = REC;
  m.regs.b = count & 0xff;
  m.regs.sp = SP0;
  m.mem.write8(ACTIVE_FLAG, active);
  m.mem.write8(STEP_COUNTER, counter);
  for (let i = 0; i < 3; i++) m.mem.write8(STAGE_TIMERS + i, timers[i]);
  return m;
}

// b != 1 -> stepper, counter in 1..6 with stage-1 timer live -> a shallow, deterministic path
const craftStep = () => seat(BASE.clone(), 0x03, { counter: 0x01, timers: [0x05, 0, 0] });
// b == 1 -> spawn (active flag clear); the checksum tail reads ROM and (genuine image) writes nothing
const craftSpawn = () => seat(BASE.clone(), 0x01, { active: 0x00 });

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: stepper (b!=1) and spawn (b==1) — decrementPhaseCounterAndDispatchSpawnOrStep == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["stepper", craftStep], ["spawn", craftSpawn]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    decrementPhaseCounterAndDispatchSpawnOrStep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  // B threading: the stepper leaves B untouched, so it must equal the oracle's decremented B
  const os = craftStep();
  const cs = craftStep();
  oracle(os);
  decrementPhaseCounterAndDispatchSpawnOrStep(cs);
  assert.equal(cs.regs.b & 0xff, os.regs.b & 0xff, "decremented B must equal the oracle (stepper leaves it)");
  assert.equal(cs.regs.b & 0xff, 0x02, "sanity: dec b from 3 -> 2, untouched by the stepper");
  console.log(`  EQUAL: stepper + spawn identical (RAM −stack); B=${hx(cs.regs.b & 0xff)} threaded`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the stepper footprint (b!=1) at its exact values", () => {
  const m = craftStep();
  const b0 = m.dumpState();
  oracle(m);
  const a1 = m.dumpState();
  const expected = new Map([
    [STEP_COUNTER, 0x02], //   counter bumped 1 -> 2
    [STAGE_TIMERS, 0x04], //   stage-1 timer 5 -> 4
    [REC + 0x13, 0x02], //     latched move dir
    [REC + 0x16, 0x01], //     latched speed
  ]);
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] === a1[off]) continue;
    const addr = m.stateOffsetToAddr(off);
    if (inDeadStack(addr)) continue;
    assert.ok(expected.has(addr), `unexpected write at ${hx(addr)}`);
  }
  for (const [addr, val] of expected) {
    assert.equal(m.mem.read8(addr), val, `cell ${hx(addr)} expected ${hx(val)}`);
  }
  console.log(`  WRITE-SET(stepper): ${expected.size} cells at exact values`);
});

test("WRITE-SET: the spawn footprint (b==1) seeds the record + active flag", () => {
  const m = craftSpawn();
  oracle(m);
  const spawn = new Map([
    [ACTIVE_FLAG, 0x01],
    [REC + 0x0b, 0x01],
    [REC + 0x13, 0x03],
    [REC + 0x16, 0x01],
    [REC + 0x07, 0x02],
    [REC + 0x0c, 0x47], // animation pointer 0x3847, low
    [REC + 0x0d, 0x38], // animation pointer 0x3847, high
    [REC + 0x0e, 0x00],
  ]);
  for (const [addr, val] of spawn) {
    assert.equal(m.mem.read8(addr), val, `cell ${hx(addr)} expected ${hx(val)}`);
  }
  assert.equal(m.mem.read8(TAMPER), 0x00, "the genuine ROM checksum must not trip the tamper flag");
  console.log(`  WRITE-SET(spawn): ${spawn.size} cells at exact values, no tamper`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a non-decremented B is CAUGHT by the register compare", () => {
  const o = craftStep();
  const c = craftStep();
  oracle(o);
  decrementPhaseCounterAndDispatchSpawnOrStep(c);
  c.regs.b = 0x03; // BUG: dec b was skipped -> B stayed at the entry value
  assert.notEqual(c.regs.b & 0xff, o.regs.b & 0xff, "the register compare FAILED to catch a skipped dec b");
  console.log("  TEETH(register-B): skipped dec b caught");
});

test("TEETH: the two branches produce different RAM (the dispatch is load-bearing)", () => {
  const step = craftStep();
  const spawn = craftSpawn();
  oracle(step);
  oracle(spawn);
  // same crafted family, different B -> the two delegates must leave different RAM
  const bothStep = craftStep();
  oracle(bothStep);
  const d = firstStateDiff(step.dumpState(), spawn.dumpState(), (off) => step.stateOffsetToAddr(off), inDeadStack);
  assert.notEqual(d, null, "positive control: the stepper and spawn paths must differ in RAM");
  // and the spawn branch alone touches the active flag the stepper never writes
  assert.equal(spawn.mem.read8(ACTIVE_FLAG), 0x01, "spawn sets the active flag");
  assert.equal(bothStep.mem.read8(ACTIVE_FLAG), 0x00, "stepper leaves the active flag untouched");
  console.log(`  TEETH(branch): stepper vs spawn diverge at ${hx(d.addr ?? 0)}; active flag is the discriminator`);
});

test("TEETH: a wrong stepper field is CAUGHT by the RAM diff", () => {
  const o = craftStep();
  const c = craftStep();
  oracle(o);
  decrementPhaseCounterAndDispatchSpawnOrStep(c);
  c.mem.write8(REC + 0x13, 0xff); // BUG: the latched move dir must be 2
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong latched field");
  assert.equal(d.addr, REC + 0x13, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(field): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
