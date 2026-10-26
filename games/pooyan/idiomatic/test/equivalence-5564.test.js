// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnFormationEnemiesOnTimer (ROM 0x5564, Pooyan) — the frame-timer gated formation
 * spawner: tick the reload timer and return while running; on expiry reload it, advance the spawn
 * cursor, pick a spawn count, and tail the scan/seed loop over the formation-spawn blocks.
 *
 * The module dissolves the rst-20 table fetch (fetchByteFromTableIndex) and the scan/seed tail (seedFirstFreeSlotForTimedSpawnWithTamperCheck) into
 * direct calls; the oracle keeps them frozen. spawnFormationEnemiesOnTimer is a void spawner (no register survives), so
 * equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The expiry arm seats the timer at 1 (drains to 0 -> the reload/advance/tail runs) with the round at
 * 5 (spawn count 2) and both walked formation blocks held live, so the tail seeds nothing and the
 * expiry footprint is the timer reload + cursor advance alone. The running arm holds the timer at 5.
 *
 * Jobs:
 *   1. EQUAL — expiry and running: oracle == spawnFormationEnemiesOnTimer in RAM (−stack).
 *   2. WRITE-SET — expiry advances the spawn cursor; the running arm holds it, so they differ.
 *   3. TEETH — a wrong spawn-cursor byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5564.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5564 as oracle } from "../../translated/loc_5564.js";
import { spawnFormationEnemiesOnTimer } from "../spawnFormationEnemiesOnTimer.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TIMER = 0x8d06; //   reload timer (SPAWN_RELOAD_TIMER)
const CURSOR = 0x8d14; //  spawn cursor (SPAWN_SEQUENCE_INDEX_8D14); low nibble indexes the reload table
const ROUND = 0x8907; //   round counter (>= 4 -> spawn count 2)
const BLOCK = 0x8c60; //   formation-spawn block table (FORMATION_SPAWN_TABLE), stride 0x18
const SP0 = 0x8ff0; //     inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: round 5 (count 2), spawn cursor at 3, both walked blocks live (tail seeds nothing). */
function craft(timer) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[TIMER] = timer & 0xff;
  m.mem8[CURSOR] = 0x03;
  m.mem8[ROUND] = 0x05; // >= 4 -> count 2 -> tail runs
  m.mem8[BLOCK] = 0x01; // block 0 live -> skipped
  m.mem8[BLOCK + 0x18] = 0x01; // block 1 live -> skipped (count 2 walks two blocks)
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: expiry + running states — spawnFormationEnemiesOnTimer == oracle in RAM (−stack)", () => {
  for (const [label, timer] of [["expiry (timer 1)", 0x01], ["running (timer 5)", 0x05]]) {
    const o = craft(timer);
    oracle(o);
    const c = craft(timer);
    spawnFormationEnemiesOnTimer(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: expiry + running identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the timer gates the reload path (spawn cursor advance)", () => {
  const expiry = craft(0x01);
  oracle(expiry);
  assert.equal(expiry.mem8[CURSOR], 0x04, "timer expiry -> spawn cursor advanced 3 -> 4");

  const running = craft(0x05);
  oracle(running);
  assert.equal(running.mem8[CURSOR], 0x03, "timer running -> cursor held");

  assert.notEqual(expiry.mem8[CURSOR], running.mem8[CURSOR], "the timer must gate the reload path");
  console.log("  WRITE-SET: expiry advances the cursor, running holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong spawn-cursor byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  spawnFormationEnemiesOnTimer(c);
  c.mem8[CURSOR] = 0x03; // BUG: the reload path must have advanced the cursor to 0x04
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cursor byte — it is worthless");
  assert.equal(d.addr, CURSOR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong cursor byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
