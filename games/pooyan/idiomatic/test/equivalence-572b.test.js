// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnEnemyIntoFreeActorSlot (ROM 0x572b, Pooyan) — try to spawn one actor into a slot.
 *
 * SEATING: +4 SP CALLER-SKIP dissolved to a boolean. A slot whose low bit is set is live: the
 * oracle `ret c`s (balanced) and the module returns false so the caller keeps scanning. An empty
 * slot is initialised, a spawn column/velocity/timer built, and the scan-state head run; the
 * oracle then `pop af; ret`s one frame up and the module returns true so the caller aborts its
 * sweep. Compared on RAM (dumpState) minus stack scratch below the entry SP plus the forwarded boolean; the register
 * file is not compared. Entry registers IX/C/E are the param-default bridge.
 *
 * Cases are CRAFTED: a plain attract boot does not seat an empty slot at this point. The spawn
 * case routes the scan-state head into its decrement-and-return branch (counter 3, sub-state 1) so
 * the delegated stepper terminates without re-arming.
 *
 * Jobs:
 *   1. EQUAL — live slot (skip, boolean false) and empty slot (spawn, boolean true): oracle ==
 *      module in RAM (−stack) + forwarded boolean.
 *   2. WRITE-SET — a live slot leaves RAM untouched; a spawn sets the slot lead byte and bumps the
 *      active count.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; a spawn-returns-false twin and a
 *      live-returns-true twin are caught by the boolean.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-572b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_572b as oracle } from "../../translated/loc_572b.js";
import { spawnEnemyIntoFreeActorSlot } from "../spawnEnemyIntoFreeActorSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SLOT = 0x8ae0; // ENEMY_ACTOR_TABLE, first 0x18-byte actor slot
const ROUND = 0x8907; // ROUND_COUNTER
const DIFFICULTY = 0x8820; // DIFFICULTY_DSW
const GAUGE = 0x8908; // GAUGE_PHASE_COUNTER
const STAGEC = 0x8901; // STAGE_COUNTDOWN
const WAVEP = 0x8d7d; // WAVE_PROGRESS_COUNTER
const BIAS = 0x8d4c; // SPAWN_COLUMN_BIAS
const SPAWN_TIMER = 0x8d07; // ENEMY_SPAWN_TIMER
const ACTIVE_COUNT = 0x8d40; // ACTIVE_ENEMY_COUNT
const SUBSTATE_COUNTER = 0x8d46; // scan-state head counter
const SUBSTATE_0 = 0x8d47; // first sub-state byte
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the entry interface + shared spawn inputs; the slot is empty (spawns) by default. */
function seat(m, { col = 0x05, slotLive = false } = {}) {
  m.regs.ix = SLOT;
  m.regs.c = col;
  m.regs.e = 0x22;
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.mem.write8(ROUND, 0x00); //       even round
  m.mem.write8(DIFFICULTY, 0x01);
  m.mem.write8(GAUGE, 0x00); //       gauge < 4 -> no bias
  m.mem.write8(STAGEC, 0x05); //      >= 3 -> the column shift is a no-op
  m.mem.write8(WAVEP, 0x00);
  m.mem.write8(BIAS, 0x00);
  m.mem.write8(SPAWN_TIMER, 0x00);
  m.mem.write8(ACTIVE_COUNT, 0x00);
  m.mem.write8(SUBSTATE_COUNTER, 0x03); // scan-state head: decrement-and-return branch
  m.mem.write8(SUBSTATE_0, 0x01);
  m.mem.write8(SLOT + 0x00, slotLive ? 0x01 : 0x00); // low bit set => slot live
  m.mem.write8(SLOT + 0x01, 0x00);
  return m;
}

const craftSpawn = () => seat(BASE.clone(), { slotLive: false });
const craftLive = () => seat(BASE.clone(), { slotLive: true });

const CASES = [
  { name: "live slot -> keep scanning", craft: craftLive, ret: false },
  { name: "empty slot -> spawn", craft: craftSpawn, ret: true },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: spawnEnemyIntoFreeActorSlot == oracle in RAM (−stack) + forwarded boolean", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    const ret = spawnEnemyIntoFreeActorSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret, cfg.ret, `${cfg.name}: forwarded boolean must be ${cfg.ret}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack + boolean)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a live slot is inert; a spawn claims the slot and bumps the active count", () => {
  const live = craftLive();
  const b0 = live.dumpState();
  oracle(live);
  assert.deepEqual([...live.dumpState()], [...b0], "a live slot must leave RAM untouched");

  const spawn = craftSpawn();
  spawnEnemyIntoFreeActorSlot(spawn);
  assert.equal(spawn.mem.read8(SLOT + 0x00), 0x01, "a spawn sets the slot lead byte");
  assert.equal(spawn.mem.read8(ACTIVE_COUNT), 0x01, "a spawn bumps the active enemy count");
  console.log("  WRITE-SET: live inert; spawn claims + counts");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftSpawn();
  const c = craftSpawn();
  oracle(o);
  spawnEnemyIntoFreeActorSlot(c);
  c.mem.write8(SLOT + 0x07, (o.mem.read8(SLOT + 0x07) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte");
  assert.equal(d.addr, SLOT + 0x07, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a spawn-returns-false twin and a live-returns-true twin are CAUGHT by the boolean", () => {
  assert.throws(
    () => assert.equal(((m) => (spawnEnemyIntoFreeActorSlot(m), false))(craftSpawn()), true),
    "a spawn must abort the sweep -> true",
  );
  assert.throws(
    () => assert.equal(((m) => (spawnEnemyIntoFreeActorSlot(m), true))(craftLive()), false),
    "a live slot must keep scanning -> false",
  );
  console.log("  TEETH(boolean): spawn-false and live-true twins caught");
});
