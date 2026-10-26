// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedNextEagleWave (ROM 0x72e1, Pooyan) — "seed the next eagle wave":
 * runs only while ENEMY_TARGET_REC0 is clear; raises WAVE_LAUNCH_FLAG and advances WAVE_INDEX;
 * on the fourth wave it just bumps WAVE_OUTER_PHASE and reloads WAVE_HOLD_TIMER; otherwise it
 * initialises two records per wave in the enemy-actor table (stride 0x18) from the four-byte
 * ROM parameter table at EAGLE_WAVE_PARAM_TABLE, then clears the outer-phase/arrived counters.
 *
 * This is the CYCLE-FREE / memory-equivalence gate. The routine WRITES work RAM (reading its
 * per-record fields out of ROM), so every case runs the oracle on one fresh clone and seedNextEagleWave
 * on another, compared on the go-forward contract: RAM (dumpState, minus stack scratch below the entry SP). There
 * is NO register live-out — the caller returns immediately after seeding — and the routine
 * reads no input register, so nothing else is compared.
 *
 * Jobs:
 *   1. EQUAL — the busy-target guard, waves 1/2/3 (record seeding), and wave 4 (re-arm):
 *      oracle == seedNextEagleWave in RAM(−stack).
 *   2. WRITE-SET — a seeding wave writes only the wave cells + the per-record field footprint.
 *   3. TEETH — a wrong seeded record byte is caught in the arena, and a wrong WAVE_INDEX at
 *      its own cell.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-72e1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_72e1 as oracle } from "../../translated/loc_72e1.js";
import { seedNextEagleWave } from "../seedNextEagleWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_TARGET_REC0,
  WAVE_LAUNCH_FLAG,
  WAVE_INDEX,
  WAVE_RECORD_COUNT,
  WAVE_OUTER_PHASE,
  WAVE_RECORDS_ARRIVED,
  ENEMY_ACTOR_TABLE,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RECORD_STRIDE = 0x18;
const REC_OFFSETS = [0x00, 0x03, 0x04, 0x05, 0x06, 0x0f, 0x10]; // every field the seeder may touch
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** Fresh clone: the busy-target gate + the wave index seeded, SP in the dead stack window. */
function craft(rec0, waveSeed) {
  const m = BASE.clone();
  m.mem.write8(ENEMY_TARGET_REC0, rec0 & 0xff);
  m.mem.write8(WAVE_INDEX, waveSeed & 0xff);
  m.regs.sp = 0x8ffe;
  return m;
}

// rec0 (busy gate), waveSeed (WAVE_INDEX before the bump): the guard, three seeding waves,
// and the fourth-wave re-arm path.
const CASES = [
  { rec0: 0x01, waveSeed: 0x02, label: "guard (target busy)" },
  { rec0: 0x00, waveSeed: 0x00, label: "wave 1 (2 records)" },
  { rec0: 0x00, waveSeed: 0x01, label: "wave 2 (4 records)" },
  { rec0: 0x00, waveSeed: 0x02, label: "wave 3 (6 records)" },
  { rec0: 0x00, waveSeed: 0x03, label: "wave 4 (re-arm)" },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: oracle == seedNextEagleWave in RAM(−stack) across guard / waves 1-3 / re-arm", () => {
  for (const { rec0, waveSeed, label } of CASES) {
    const o = craft(rec0, waveSeed);
    const c = craft(rec0, waveSeed);
    oracle(o);
    seedNextEagleWave(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${label}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} mine=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} wave-seed cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a seeding wave writes only the wave cells + the per-record footprint", () => {
  const { rec0, waveSeed } = CASES[2]; // wave 2 -> 4 records
  const recordCount = ((waveSeed + 1) * 2) & 0xff;

  const allowed = new Set([WAVE_LAUNCH_FLAG, WAVE_INDEX, WAVE_RECORD_COUNT, WAVE_OUTER_PHASE, WAVE_RECORDS_ARRIVED]);
  for (let i = 0; i < recordCount; i++) {
    const rec = (ENEMY_ACTOR_TABLE + i * RECORD_STRIDE) & 0xffff;
    for (const off of REC_OFFSETS) allowed.add((rec + off) & 0xffff);
  }

  const before = craft(rec0, waveSeed);
  const after = craft(rec0, waveSeed);
  const b0 = before.dumpState();
  oracle(after);
  const a1 = after.dumpState();

  const changed = [];
  for (let off = 0; off < b0.length; off++) {
    if (b0[off] !== a1[off]) changed.push(after.stateOffsetToAddr(off));
  }
  for (const addr of changed) assert.ok(allowed.has(addr), `oracle wrote outside the footprint at ${hx(addr)}`);
  // Cells guaranteed to change over zero-initialised boot RAM.
  for (const cell of [WAVE_LAUNCH_FLAG, WAVE_INDEX, WAVE_RECORD_COUNT, ENEMY_ACTOR_TABLE, (ENEMY_ACTOR_TABLE + 0x05) & 0xffff]) {
    assert.ok(changed.includes(cell), `expected a write at ${hx(cell)}`);
  }
  console.log(`  WRITE-SET: ${changed.length} writes, all within the wave + ${recordCount}-record footprint`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded record byte is caught in the arena", () => {
  const { rec0, waveSeed } = CASES[2];
  const o = craft(rec0, waveSeed);
  const c = craft(rec0, waveSeed);
  oracle(o);
  seedNextEagleWave(c);
  c.mem.write8(ENEMY_ACTOR_TABLE, (c.mem.read8(ENEMY_ACTOR_TABLE) ^ 0x01) & 0xff); // BUG: corrupt record 0's active byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong record byte — it is worthless");
  assert.equal(d.addr, ENEMY_ACTOR_TABLE, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(ENEMY_ACTOR_TABLE)})`);
  console.log(`  TEETH/arena: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong WAVE_INDEX is caught at its own cell", () => {
  const { rec0, waveSeed } = CASES[2];
  const o = craft(rec0, waveSeed);
  const c = craft(rec0, waveSeed);
  oracle(o);
  seedNextEagleWave(c);
  assert.equal(c.mem.read8(WAVE_INDEX), o.mem.read8(WAVE_INDEX), "sanity: module advanced WAVE_INDEX like the oracle");
  c.mem.write8(WAVE_INDEX, (c.mem.read8(WAVE_INDEX) + 1) & 0xff); // BUG: over-advanced wave index

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong WAVE_INDEX — it is worthless");
  assert.equal(d.addr, WAVE_INDEX, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/wave: wrong WAVE_INDEX caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
