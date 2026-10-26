// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runSpawnTickAndHunterSweep (ROM 0x2b8d, Pooyan) — the spawn/formation epilogue. It
 * returns at once while the lead-actor state (0x8a82) is below 3; at that quorum it runs the
 * formation-spawn tick (tickFormationSpawnAndScanSlots) then drives the hunter records (dispatchAllHunterRecordStates), in that order.
 *
 * SEATING: BALANCED-WIRE. The oracle has a plain `ret c` (net SP 0) on the below-quorum branch,
 * then two pattern-A balanced calls and a plain `ret`; net SP 0. A void epilogue — no register
 * is read back — so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in scratch so the sub-passes' nested pushes drop out of the diff.
 *
 * The states are CRAFTED. The formation tick is gated to its decrement-and-return branch (wave
 * count high enough to skip the ready-sprite helper, spawn timer left running) so it just ticks
 * the timer. The hunter drive is seated with record 0 routed to the hunter move handler (index 1)
 * with its hold field high and its script cursor on a plain delta byte, so it ticks a few
 * record-local bytes; the other 16 hunter records are gate-inert. Each sub-pass thus has a
 * contained, observable footprint, isolating runSpawnTickAndHunterSweep's own job — the quorum gate, the order,
 * and the wiring — from the sub-passes' internals, which their own gates cover.
 *
 * Jobs:
 *   1. EQUAL — below quorum (inert) and at quorum (both sub-passes act): module == oracle in RAM.
 *   2. WRITE-SET — below quorum leaves RAM untouched; at quorum ticks the timer and record 0.
 *   3. TEETH — a wrong byte is caught by the RAM diff; a no-gate twin (runs the sub-passes below
 *      quorum), a missing-tick twin, and a missing-drive twin each diverge from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2b8d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2b8d as oracle } from "../../translated/loc_2b8d.js";
import { runSpawnTickAndHunterSweep } from "../runSpawnTickAndHunterSweep.js";
import { tickFormationSpawnAndScanSlots } from "../tickFormationSpawnAndScanSlots.js";
import { dispatchAllHunterRecordStates } from "../dispatchAllHunterRecordStates.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, LEAD_ACTOR_STATE, ENEMY_ACTOR_TABLE, WAVE_ARRIVAL_COUNTER, FORMATION_SPAWN_TIMER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAT = ENEMY_ACTOR_TABLE; // 0x8ae0 — hunter record table
const STRIDE = 0x18;
const HUNTER_COUNT = 0x11; // 17 records swept by the hunter drive
const REC0_HOLD = EAT + 0x0e; //  animation frame-hold on record 0
const REC0_POS = EAT + 0x03; //   record 0 horizontal position (delta target)
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the shared world: gated formation tick + one dispatching hunter record; state selectable. */
function seat(m, { state } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(LEAD_ACTOR_STATE, state);
  // formation-spawn tick -> decrement-and-return branch
  m.mem.write8(WAVE_ARRIVAL_COUNTER, 0x02); // >= 2 -> skip the ready-sprite helper
  m.mem.write8(FORMATION_SPAWN_TIMER, 0x05); // running -> just decrements
  // hunter table: all inert...
  for (let i = 0; i < HUNTER_COUNT; i++) for (let b = 0; b < STRIDE; b++) m.mem.write8(EAT + i * STRIDE + b, 0x00);
  // ...except record 0 -> hunter move handler (index 1), contained delta step
  m.mem.write8(EAT + 0x00, 0x01); // active
  m.mem.write8(EAT + 0x02, 0x12); // state; (0x12 & 0x1f) - 0x11 = 1 -> move handler
  m.mem.write8(EAT + 0x0e, 0x05); // anim hold high -> stepper just decrements
  m.mem.write8(EAT + 0x15, 0x00); // sign flag: subtract path
  m.mem.write8(EAT + 0x16, (EAT + 0x0a) & 0xff); // script cursor low  -> a record-local byte
  m.mem.write8(EAT + 0x17, (EAT + 0x0a) >> 8); //  script cursor high
  m.mem.write8(EAT + 0x0a, 0x02); // the delta byte (not 0xff/0x88)
  m.mem.write8(EAT + 0x03, 0x40); // position low (delta target)
  m.mem.write8(EAT + 0x04, 0x00); // position high
  return m;
}

const craftBelow = () => seat(BASE.clone(), { state: 0x01 }); // below quorum -> inert
const craftQuorum = () => seat(BASE.clone(), { state: 0x03 }); // at quorum -> both sub-passes run

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["below quorum (inert)", craftBelow], ["at quorum (both run)", craftQuorum]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    runSpawnTickAndHunterSweep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: below quorum is inert; at quorum ticks the timer and record 0", () => {
  const below = craftBelow();
  const b0 = below.dumpState();
  oracle(below);
  assert.deepEqual([...below.dumpState()], [...b0], "below quorum must leave RAM untouched");

  const q = craftQuorum();
  oracle(q);
  assert.equal(q.mem.read8(FORMATION_SPAWN_TIMER), 0x04, "quorum must tick the formation timer");
  assert.equal(q.mem.read8(REC0_POS), 0x3e, "quorum must step hunter record 0's position (0x40 - 2)");
  assert.equal(q.mem.read8(REC0_HOLD), 0x04, "quorum must tick hunter record 0's anim hold");
  console.log("  WRITE-SET: below inert; quorum ticks timer + record 0");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong byte is CAUGHT by the RAM diff", () => {
  const o = craftQuorum();
  const c = craftQuorum();
  oracle(o);
  runSpawnTickAndHunterSweep(c);
  c.mem.write8(FORMATION_SPAWN_TIMER, (o.mem.read8(FORMATION_SPAWN_TIMER) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, FORMATION_SPAWN_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a no-gate twin (sub-passes run below quorum) diverges from the oracle", () => {
  const o = craftBelow();
  const twin = craftBelow();
  oracle(o); // below quorum -> inert
  tickFormationSpawnAndScanSlots(twin); // twin ignores the quorum gate and runs both sub-passes...
  dispatchAllHunterRecordStates(twin);
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "a missing quorum gate must be caught");
  console.log(`  TEETH(no-gate): caught at ${hx(d.addr)}`);
});

test("TEETH: a missing-tick twin (drops tickFormationSpawnAndScanSlots) diverges at the formation timer", () => {
  const o = craftQuorum();
  const twin = craftQuorum();
  oracle(o);
  dispatchAllHunterRecordStates(twin); // runs only the hunter drive
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "a dropped formation tick must be caught");
  assert.equal(d.addr, FORMATION_SPAWN_TIMER, `missing-tick teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(missing-tick): caught at ${hx(d.addr)}`);
});

test("TEETH: a missing-drive twin (drops dispatchAllHunterRecordStates) diverges at hunter record 0", () => {
  const o = craftQuorum();
  const twin = craftQuorum();
  oracle(o);
  tickFormationSpawnAndScanSlots(twin); // runs only the formation tick
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "a dropped hunter drive must be caught");
  assert.ok(d.addr >= EAT && d.addr < EAT + STRIDE, `missing-drive teeth caught outside record 0: ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(missing-drive): caught at ${hx(d.addr)}`);
});
