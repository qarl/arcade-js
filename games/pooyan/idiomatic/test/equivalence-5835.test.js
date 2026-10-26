// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnSpecialActorElseStep (ROM 0x5835, Pooyan) — spawn the singleton actor, or step
 * it if already active.
 *
 * SEATING: TAIL-CALL. Every exit is a tail hand-off (to the stepper when active, to the checksum
 * walk after a spawn), so the effective seating is the delegatee's and the module returns nothing
 * a caller reads. Equivalence is RAM (dumpState) minus stack scratch below the entry SP; the register file is not
 * compared. Entry register IX (the record pointer) is the param-default bridge.
 *
 * Cases are CRAFTED. The active case routes the stepper into its decrement-and-return branch
 * (counter 3, sub-state 1) so it terminates without re-arming; the spawn case runs the seed +
 * animation arm + image-integrity checksum end to end.
 *
 * Jobs:
 *   1. EQUAL — active (step existing) and inactive (spawn): oracle == module in RAM (−stack).
 *   2. WRITE-SET — a spawn sets the active flag and seeds the record.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a twin that omits the active-flag
 *      write diverges at the flag.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5835.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5835 as oracle } from "../../translated/loc_5835.js";
import { spawnSpecialActorElseStep } from "../spawnSpecialActorElseStep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT = 0x8ae0; // ENEMY_ACTOR_TABLE, actor record pointed at by IX
const ACTIVE = 0x8d4a; // SPECIAL_ACTOR_ACTIVE_FLAG
const SUBSTATE_COUNTER = 0x8d46; // stepper counter
const SUBSTATE_0 = 0x8d47; // first sub-state byte
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record pointer; `active` decides step-vs-spawn. */
function seat(m, { active = false } = {}) {
  m.regs.ix = SLOT;
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.mem.write8(ACTIVE, active ? 0x01 : 0x00);
  m.mem.write8(SUBSTATE_COUNTER, 0x03); // stepper: decrement-and-return branch
  m.mem.write8(SUBSTATE_0, 0x01);
  return m;
}

const craftSpawn = () => seat(BASE.clone(), { active: false });
const craftStep = () => seat(BASE.clone(), { active: true });

const CASES = [
  { name: "active -> step existing", craft: craftStep },
  { name: "inactive -> spawn", craft: craftSpawn },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: spawnSpecialActorElseStep == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    spawnSpecialActorElseStep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a spawn marks the actor active and seeds the record", () => {
  const spawn = craftSpawn();
  spawnSpecialActorElseStep(spawn);
  assert.equal(spawn.mem.read8(ACTIVE), 0x01, "a spawn sets the active flag");
  assert.equal(spawn.mem.read8(SLOT + 0x13), 0x03, "a spawn seeds the record");
  assert.equal(spawn.mem.read8(SLOT + 0x07), 0x02, "a spawn seeds the record");
  console.log("  WRITE-SET: spawn activates + seeds");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftSpawn();
  const c = craftSpawn();
  oracle(o);
  spawnSpecialActorElseStep(c);
  c.mem.write8(SLOT + 0x13, (o.mem.read8(SLOT + 0x13) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte");
  assert.equal(d.addr, SLOT + 0x13, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that omits the active-flag write diverges at the flag", () => {
  const o = craftSpawn();
  const twin = craftSpawn();
  oracle(o);
  spawnSpecialActorElseStep(twin);
  twin.mem.write8(ACTIVE, 0x00); // a rewrite that forgot to mark the actor active
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "the gate FAILED to catch a missing active-flag write");
  assert.equal(d.addr, ACTIVE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(active flag): caught at ${hx(d.addr)}`);
});
