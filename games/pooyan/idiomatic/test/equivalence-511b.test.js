// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for serviceEnemySpawns (ROM 0x511b, Pooyan) — the per-frame enemy-update dispatcher:
 * on an odd round run the three spawn schedulers then the spawn-cadence tick or the shared tail; on
 * an even round run the formation spawn/init then the shared tail (the boot-frontier trampoline, then
 * the enemy-spawn tick unless the script-advance guard is set).
 *
 * The module dissolves 53b0/1171/56e8 and the spawn schedulers 54c5/5519/5564 and the shared-tail
 * 5146 to direct idiomatic calls; the oracle drives all of them
 * through the routines map. serviceEnemySpawns plain-returns — it does NOT tail-dispatch, so no SP-tooth applies. serviceEnemySpawns is a void
 * updater — no register survives — so the register file is not compared; equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in dead stack so the nested pushes drop out of the diff.
 *
 * Two crafted rounds cover both branches: an even round exercises the formation spawn/init (53b0) and
 * the shared tail; an odd round with the hunter-flip flag exercises the three schedulers and the
 * spawn-cadence tick (1171).
 *
 * Jobs:
 *   1. EQUAL — even + odd rounds: oracle == serviceEnemySpawns in RAM (−stack).
 *   2. WRITE-SET — the even round's formation spawn arms the spawn latch and the record's state byte.
 *   3. TEETH — a wrong spawn-latch byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-511b.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_511b as oracle } from "../../translated/loc_511b.js";
import { serviceEnemySpawns } from "../serviceEnemySpawns.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const ROUND = 0x8907; //          ROUND_COUNTER; bit0 selects the odd/even branch
const HUNTER_FLIP = 0x8f61; //    HUNTER_SPAWN_FLIP_FLAG; set on the odd path -> spawn-cadence tick
const SPAWN_LATCH = 0x8d59; //    armed to 1 by the formation spawn (53b0)
const FORMATION = 0x8c30; //      FORMATION_TABLE; 53b0 writes rec+0 = 1 on spawn
const SP0 = 0x8ff0; //            inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone. `round` picks the branch; the odd path also arms the hunter-flip flag. On a fresh
 *  clone the frame counter and spawn latch are 0, so an even round's 53b0 spawns. */
function craft(round) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[ROUND] = round;
  if (round & 0x01) m.mem8[HUNTER_FLIP] = 0x01; // odd path -> spawn-cadence tick after the schedulers
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: even + odd rounds — serviceEnemySpawns == oracle in RAM (−stack)", () => {
  for (const [label, round] of [["even (formation + tail)", 0x02], ["odd (schedulers + cadence)", 0x03]]) {
    const o = craft(round);
    oracle(o);
    const c = craft(round);
    serviceEnemySpawns(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: even + odd rounds identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the even round's formation spawn arms the latch and the record state", () => {
  const m = craft(0x02);
  assert.equal(m.mem8[SPAWN_LATCH], 0x00, "precondition: spawn latch clear");
  oracle(m);
  assert.equal(m.mem8[SPAWN_LATCH], 0x01, "formation spawn armed the spawn latch");
  assert.equal(m.mem8[FORMATION], 0x01, "formation record state byte seeded to 1");
  console.log("  WRITE-SET: spawn latch + formation state armed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong spawn-latch byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x02);
  const c = craft(0x02);
  oracle(o);
  serviceEnemySpawns(c);
  c.mem8[SPAWN_LATCH] = 0x00; // BUG: the formation spawn must have armed the latch
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong spawn-latch byte — it is worthless");
  assert.equal(d.addr, SPAWN_LATCH, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong spawn-latch byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
