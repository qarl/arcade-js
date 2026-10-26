// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickEnemySpawnTimerAndGateSpawn (ROM 0x56e8, Pooyan) — the enemy-spawn tick.
 *
 * SEATING: BALANCED (plain ret) -> WIRE. Two callees are dissolved: the even-round arm TAIL-CALLS
 * gateEnemySpawnOnActiveCountAndInit (its seating), and the per-slot spawnEnemyIntoFreeActorSlot is a +4 SP caller-skip dissolved to a boolean
 * (true = spawned -> abort the sweep). The register file is NOT compared: tickEnemySpawnTimerAndGateSpawn has no register
 * live-out — its caller (serviceEnemySpawns tail, dispatched from the runActiveGameplayFrame straight-line sequence) rets
 * straight after and reads nothing back. Compared on RAM (dumpState) minus stack scratch below the entry SP only.
 *
 * Cases are CRAFTED (a plain attract boot does not sit at this gate). They exercise every arm:
 *   DEC        — timer nonzero: decrement and return.
 *   TAIL       — timer 0, even round: hand off to gateEnemySpawnOnActiveCountAndInit (seated so it does not launch).
 *   RETZ/RETC  — stage countdown equal to / below the active count: bail untouched.
 *   RETNC      — active count at the difficulty threshold (SPEED_INDEX>=3 -> 6): bail untouched.
 *   NOSWEEP    — the SPEED_INDEX<3 threshold arm (threshold = SPEED_INDEX+4), gate passes, all six
 *                slots live -> full sweep, no spawn.
 *   SPAWN      — gate passes, slot 0 live + slot 1 empty -> the sweep advances one stride and
 *                spawns into slot 1, then early-returns (the dissolved caller-skip).
 *
 * Jobs:
 *   1. EQUAL — oracle == module in RAM (−stack) across all seven arms.
 *   2. WRITE-SET — DEC decrements the timer; a spawn claims slot 1 and bumps the active count; a
 *      bail arm leaves RAM byte-identical.
 *   3. TEETH — a wrong spawned byte is caught by the RAM diff; a do-nothing twin is caught on both
 *      the DEC arm (missed decrement) and the SPAWN arm (missed spawn), so the gate is not vacuous.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-56e8.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_56e8 as oracle } from "../../translated/loc_56e8.js";
import { tickEnemySpawnTimerAndGateSpawn } from "../tickEnemySpawnTimerAndGateSpawn.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SPAWN_TIMER = 0x8d07; // ENEMY_SPAWN_TIMER
const ROUND = 0x8907; //       ROUND_COUNTER
const STAGEC = 0x8901; //      STAGE_COUNTDOWN
const ACTIVE = 0x8d40; //      ACTIVE_ENEMY_COUNT
const SPEED = 0x8900; //       SPEED_INDEX
const SLOTS = 0x8ae0; //       ENEMY_ACTOR_TABLE
const STRIDE = 0x18;
const DIFFICULTY = 0x8820; //  DIFFICULTY_DSW
const GAUGE = 0x8908; //       GAUGE_PHASE_COUNTER
const BIAS = 0x8d4c; //        SPAWN_COLUMN_BIAS
const SUBSTATE_COUNTER = 0x8d46; // scan-state head counter (decrementPhaseCounterAndDispatchSpawnOrStep)
const SUBSTATE_0 = 0x8d47; //  first sub-state byte
const SP0 = 0x8ff0; //         inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the spawn-gate inputs and the six actor-slot lead bytes. */
function craft(cfg) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  const w = (a, v) => m.mem.write8(a, v & 0xff);
  w(SPAWN_TIMER, cfg.timer ?? 0x00);
  w(ROUND, cfg.round ?? 0x03); //     odd by default -> reach the gate
  w(STAGEC, cfg.stageC ?? 0x00);
  w(ACTIVE, cfg.active ?? 0x00);
  w(SPEED, cfg.speed ?? 0x00);
  // spawnEnemyIntoFreeActorSlot spawn inputs (consumed only when the sweep reaches an empty slot)
  w(DIFFICULTY, 0x01);
  w(GAUGE, 0x00);
  w(BIAS, 0x00);
  w(SUBSTATE_COUNTER, 0x03); //       scan-state head: decrement-and-return branch
  w(SUBSTATE_0, 0x01);
  const liveMask = cfg.liveMask ?? 0x00;
  for (let i = 0; i < 6; i++) {
    w(SLOTS + i * STRIDE + 0x00, liveMask & (1 << i) ? 0x01 : 0x00); // low bit => slot live
    w(SLOTS + i * STRIDE + 0x01, 0x00);
  }
  return m;
}

const ARMS = {
  DEC: { timer: 0x05 },
  TAIL: { timer: 0x00, round: 0x02, stageC: 0x00, active: 0x00 },
  RETZ: { timer: 0x00, round: 0x03, stageC: 0x04, active: 0x04 },
  RETC: { timer: 0x00, round: 0x03, stageC: 0x03, active: 0x05 },
  RETNC: { timer: 0x00, round: 0x03, stageC: 0x0a, active: 0x06, speed: 0x05 },
  NOSWEEP: { timer: 0x00, round: 0x03, stageC: 0x0a, active: 0x04, speed: 0x01, liveMask: 0x3f },
  SPAWN: { timer: 0x00, round: 0x03, stageC: 0x07, active: 0x02, speed: 0x05, liveMask: 0x01 },
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: tickEnemySpawnTimerAndGateSpawn == oracle in RAM (−stack) across every arm", () => {
  for (const [name, cfg] of Object.entries(ARMS)) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    tickEnemySpawnTimerAndGateSpawn(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(ARMS).length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: DEC decrements the timer; SPAWN claims slot 1 + bumps the count; RETZ is inert", () => {
  const dec = craft(ARMS.DEC);
  tickEnemySpawnTimerAndGateSpawn(dec);
  assert.equal(dec.mem.read8(SPAWN_TIMER), 0x04, "DEC must decrement the spawn timer");

  const spawn = craft(ARMS.SPAWN);
  tickEnemySpawnTimerAndGateSpawn(spawn);
  assert.equal(spawn.mem.read8(SLOTS + 0x00), 0x01, "slot 0 stays live (untouched)");
  assert.equal(spawn.mem.read8(SLOTS + STRIDE + 0x00), 0x01, "the sweep spawns into slot 1");
  assert.equal(spawn.mem.read8(ACTIVE), 0x03, "a spawn bumps the active enemy count (2 -> 3)");

  const retz = craft(ARMS.RETZ);
  const before = [...retz.dumpState()];
  tickEnemySpawnTimerAndGateSpawn(retz);
  assert.deepEqual([...retz.dumpState()], before, "a bail arm must leave RAM byte-identical");
  console.log("  WRITE-SET: DEC dec; SPAWN claims slot 1 + counts; RETZ inert");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong spawned byte is CAUGHT by the RAM diff", () => {
  const o = craft(ARMS.SPAWN);
  const c = craft(ARMS.SPAWN);
  oracle(o);
  tickEnemySpawnTimerAndGateSpawn(c);
  const spawned = SLOTS + STRIDE + 0x09; // a velocity byte the spawn writes into slot 1
  c.mem.write8(spawned, (o.mem.read8(spawned) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted spawn byte");
  assert.equal(d.addr, spawned, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a do-nothing twin is CAUGHT on both the DEC and SPAWN arms (gate is not vacuous)", () => {
  for (const name of ["DEC", "SPAWN"]) {
    const o = craft(ARMS[name]);
    const noop = craft(ARMS[name]);
    oracle(o);
    // `noop` intentionally runs nothing — a module that skipped the work must be caught
    const d = ramDiffMinusStack(o, noop);
    assert.notEqual(d, null, `${name}: a do-nothing twin escaped the RAM diff`);
  }
  console.log("  TEETH(void): missed-decrement and missed-spawn twins caught");
});
