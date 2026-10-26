// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnNextScriptedEnemy (ROM 0x5334, Pooyan) — the lane-sweep script tick.
 *
 * The idiomatic module calls the idiomatic activateLaneActorSlot directly (the exx register-bank dance dissolves
 * into JS locals); the oracle drives the frozen activateLaneActorSlot across the same 6-record sweep. spawnNextScriptedEnemy is
 * a dispatched void handler — no register survives — so equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP.
 *
 * Four arms cover the branch tree: NOTLATCHED (latch clear -> ret), DELAY (script byte a running
 * delay -> tick + ret), SWEEP (delay expired -> reseed + advance pointer + sweep 6 live slots), and
 * CLEAR (script byte 0xff, threshold passed -> clear guard/latch/spawn-timer).
 *
 * Jobs:
 *   1. EQUAL — all four arms: oracle == spawnNextScriptedEnemy in RAM (−stack).
 *   2. WRITE-SET — CLEAR zeroes the guard/latch; SWEEP advances the pointer + reseeds the delay.
 *   3. TEETH — a wrong advanced pointer is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5334.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5334 as oracle } from "../../translated/loc_5334.js";
import { spawnNextScriptedEnemy } from "../spawnNextScriptedEnemy.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  SLOT_SWEEP_LATCH,
  SCRIPT_DATA_PTR,
  SCRIPT_DELAY_TIMER,
  SCRIPT_ADVANCE_GUARD,
  STAGE_COUNTDOWN,
  ENEMY_SPAWN_TIMER,
  ENEMY_ACTOR_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SCRIPT_CELL = 0x8d90; //  scratch RAM the script pointer aims at
const SP0 = 0x8fe0; //          inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(scenario) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[SLOT_SWEEP_LATCH] = scenario === "notlatched" ? 0x00 : 0x01;
  m.mem.write16(SCRIPT_DATA_PTR, SCRIPT_CELL); // 16-bit live-script pointer
  m.mem8[SCRIPT_CELL] = scenario === "clear" ? 0xff : 0x05; // 0xff terminator vs a delay count
  m.mem8[SCRIPT_DELAY_TIMER] = scenario === "sweep" ? 0x01 : 0x05; // 0x01 -> expires this tick
  m.mem8[SCRIPT_ADVANCE_GUARD] = 0x05;
  m.mem8[STAGE_COUNTDOWN] = 0x02; // below the guard -> CLEAR path clears
  m.mem8[ENEMY_SPAWN_TIMER] = 0x09;
  if (scenario === "sweep") {
    for (let n = 0; n < 6; n++) m.mem8[ENEMY_ACTOR_TABLE + n * 0x18] = 0x01; // all slots live -> no spawn
  }
  return m;
}

const SCENARIOS = ["notlatched", "delay", "sweep", "clear"];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: all four arms — spawnNextScriptedEnemy == oracle in RAM (−stack)", () => {
  for (const s of SCENARIOS) {
    const o = craft(s);
    oracle(o);
    const c = craft(s);
    spawnNextScriptedEnemy(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${s}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: notlatched/delay/sweep/clear identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: CLEAR zeroes guard/latch/timer; SWEEP advances the pointer + reseeds the delay", () => {
  const clear = craft("clear");
  oracle(clear);
  assert.equal(clear.mem8[SCRIPT_ADVANCE_GUARD], 0x00, "CLEAR -> guard zeroed");
  assert.equal(clear.mem8[SLOT_SWEEP_LATCH], 0x00, "CLEAR -> latch zeroed");
  assert.equal(clear.mem8[ENEMY_SPAWN_TIMER], 0x00, "CLEAR -> spawn timer zeroed");

  const sweep = craft("sweep");
  oracle(sweep);
  assert.equal(sweep.mem.read16(SCRIPT_DATA_PTR), SCRIPT_CELL + 1, "SWEEP -> pointer advanced");
  assert.equal(sweep.mem8[SCRIPT_DELAY_TIMER], 0x05, "SWEEP -> delay reseeded from the script byte");
  console.log("  WRITE-SET: CLEAR clears the three cells; SWEEP advances ptr + reseeds delay");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong advanced pointer is CAUGHT by the RAM diff", () => {
  const o = craft("sweep");
  const c = craft("sweep");
  oracle(o);
  spawnNextScriptedEnemy(c);
  c.mem.write16(SCRIPT_DATA_PTR, SCRIPT_CELL); // BUG: the sweep must have advanced the pointer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a stale script pointer — it is worthless");
  assert.equal(d.addr, SCRIPT_DATA_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: stale script pointer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
