// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnFormationEnemyOnInterval (ROM 0x54c5, Pooyan) — "spawn scheduler A".
 *
 * A difficulty gate can veto the tick below round 4; past it, the per-type countdown is drained and,
 * only when it hits zero, reloaded from the ROM table (indexed by the schedule cursor), the cursor is
 * advanced, and the routine falls into the formation spawn loop (seedFirstFreeActorBlockFromSpawnTypeTable). The module dissolves the
 * rst-0x20 lookup (fetchByteFromTableIndex) and the fall-through (seedFirstFreeActorBlockFromSpawnTypeTable) to direct calls; the oracle drives the
 * frozen versions. spawnFormationEnemyOnInterval is void — no register survives — so equivalence is RAM (− stack scratch below the entry SP).
 *
 * Jobs:
 *   1. EQUAL — round<2 veto, round∈{2,3} veto, countdown running (dec + ret), and the full
 *      pass-gate-countdown-zero spawn path all agree in RAM (−stack).
 *   2. WRITE-SET — the spawn path reloads the countdown and advances the schedule cursor.
 *   3. TEETH — a wrong countdown byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-54c5.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_54c5 as oracle } from "../../translated/loc_54c5.js";
import { spawnFormationEnemyOnInterval } from "../spawnFormationEnemyOnInterval.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  DIFFICULTY_DSW,
  SPAWN_COUNTDOWN_A,
  SPAWN_TYPE_CURSOR,
  FORMATION_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SP0 = 0x8fe0; // inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the scheduler inputs seated; the formation slot is left free for the spawn path. */
function craft({ round, difficulty = 0x00, countdown = 0x05, cursor = 0x00 }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem8[ROUND_COUNTER] = round & 0xff;
  m.mem8[DIFFICULTY_DSW] = difficulty & 0xff;
  m.mem8[SPAWN_COUNTDOWN_A] = countdown & 0xff;
  m.mem8[SPAWN_TYPE_CURSOR] = cursor & 0xff;
  m.mem8[FORMATION_TABLE] = 0x00; // slot 0 free -> the spawn path seeds it
  m.mem8[FORMATION_TABLE + 1] = 0x00;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

const CASES = [
  { name: "round<2 veto (diff<3)", args: { round: 0x00, difficulty: 0x00, countdown: 0x05 } },
  { name: "round∈{2,3} veto (diff<2)", args: { round: 0x02, difficulty: 0x00, countdown: 0x05 } },
  { name: "countdown running (dec+ret)", args: { round: 0x05, countdown: 0x03 } },
  { name: "pass-gate countdown-zero spawn", args: { round: 0x01, difficulty: 0x05, countdown: 0x01 } },
];

test("EQUAL: all scheduler paths agree in RAM (−stack)", () => {
  for (const { name, args } of CASES) {
    const o = craft(args);
    oracle(o);
    const c = craft(args);
    spawnFormationEnemyOnInterval(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} scheduler paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the spawn path advances the schedule cursor", () => {
  const o = craft({ round: 0x01, difficulty: 0x05, countdown: 0x01, cursor: 0x00 });
  oracle(o);
  assert.equal(o.mem8[SPAWN_TYPE_CURSOR], 0x01, "schedule cursor advanced 0 -> 1 (the reload block ran)");
  console.log("  WRITE-SET: schedule cursor advanced by one");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong countdown byte is CAUGHT by the RAM diff", () => {
  const args = { round: 0x05, countdown: 0x03 };
  const o = craft(args);
  const c = craft(args);
  oracle(o);
  spawnFormationEnemyOnInterval(c);
  c.mem8[SPAWN_COUNTDOWN_A] = 0x03; // BUG: the dec must have left it at 0x02
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong countdown byte — it is worthless");
  assert.equal(d.addr, SPAWN_COUNTDOWN_A, `teeth caught ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong countdown byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
