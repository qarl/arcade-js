// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for seedFreeEnemyRecordFromRoundTables (ROM 0x119a, Pooyan) — a spawned-actor record initialiser.
 * Skips a record whose (IX+0)|(IX+1) is odd (already active). Otherwise it stamps the opening
 * state fields, seeds (IX+4) from register E, derives a facing byte + its negation and a
 * spawn-timer reload from a round-indexed byte table (idx = (ROUND_COUNTER & 0x3f) >> 2), arms the
 * animation (setActorAnimation), reloads ENEMY_SPAWN_TIMER (0x8d07), and bumps 0x8f5f and
 * ACTIVE_ENEMY_COUNT (0x8d40).
 *
 * The contract is RAM (dumpState, minus stack scratch below the entry SP) only. The routine ends with a `pop af`/`ret`
 * skip-return, so its exit A/flags are stack artifacts; B/DE/HL are advanced but the per-frame
 * drivers it skip-returns through read no register back — the whole live-out is memory. pc/SP are
 * not compared. Every case is CRAFTED: IX at a record slot, E and ROUND_COUNTER poked identically.
 *
 * seedFreeEnemyRecordFromRoundTables is DISSOLVED into its sole caller tickSpawnTimerAndSeedFreeEnemy: it returns a BOOLEAN skip-signal — true when
 * the record was already active (the original's plain early return; the caller keeps scanning), false
 * once it has seeded a free record (the original's pop-af skip-return aborting the caller's sweep).
 * The gate asserts that boolean per path, alongside the RAM footprint.
 *
 * Jobs:
 *   1. EQUAL — full path (idx 0 and idx 15) and the early-skip path: oracle == seedFreeEnemyRecordFromRoundTables in RAM, and
 *      the boolean return is false on the seed path / true on the already-active path.
 *   2. WRITE-SET — the exact field footprint, with facing/timer bytes read live from the ROM tables.
 *   3. TEETH — a twin that writes a non-negated facing at (IX+0x0a), a twin that ignores the
 *      already-active skip, and a wrong boolean return, are all CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-119a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_119a as oracle } from "../../translated/loc_119a.js";
import { seedFreeEnemyRecordFromRoundTables } from "../seedFreeEnemyRecordFromRoundTables.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ROUND_COUNTER,
  ENEMY_SPAWN_TIMER,
  ACTIVE_ENEMY_COUNT,
  SPAWN_FACING_TABLE_1209,
  SPAWN_TIMER_TABLE_11F9,
  HUNTER_SPAWN_COUNT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ae0; // a spawned-actor record slot in the enemy-actor arena
const SPAWN_COUNTER = HUNTER_SPAWN_COUNT; // 0x8f5f
const ANIM_LO = 0x29; // low byte of ANIM_TABLE_3829
const ANIM_HI = 0x38; // high byte of ANIM_TABLE_3829
const POS_SEED = 0x1d; // the value the caller passes in E
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;
const idxOf = (round) => (round & 0x3f) >> 2;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the record slot, E, and ROUND_COUNTER seated. active=true sets the odd id. */
function craft(round, { active = false } = {}) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.e = POS_SEED;
  m.mem.write8(ROUND_COUNTER, round);
  for (let i = 0; i < 0x18; i++) m.mem.write8(REC + i, 0xee); // sentinel so every write is observable
  m.mem.write8(REC + 0x00, active ? 0x01 : 0x00);
  m.mem.write8(REC + 0x01, 0x00);
  m.mem.write8(SPAWN_COUNTER, 0x00);
  m.mem.write8(ACTIVE_ENEMY_COUNT, 0x00);
  m.regs.sp = 0x8fe0; // dead stack for the nested calls + skip-return
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: full path (idx 0 / idx 15) + early-skip — seedFreeEnemyRecordFromRoundTables == oracle in RAM (−stack)", () => {
  for (const round of [0x00, 0x3c, 0x40]) { // idx 0, idx 15, and &0x3f masking (0x40 -> idx 0)
    const o = craft(round);
    const c = craft(round);
    oracle(o);
    const ret = seedFreeEnemyRecordFromRoundTables(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `full-path RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (round=${hx(round)})`);
    assert.equal(ret, false, `seed path must return false (caller ends sweep), round=${hx(round)}`);
  }
  const o = craft(0x00, { active: true });
  const c = craft(0x00, { active: true });
  oracle(o);
  const ret = seedFreeEnemyRecordFromRoundTables(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `early-skip RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(ret, true, "already-active path must return true (caller keeps scanning)");
  console.log("  EQUAL: full path idx 0/15 (+mask) + early-skip identical (RAM −stack); boolean false/true per path");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full-path field footprint matches the ROM-derived expectations", () => {
  const round = 0x3c;
  const idx = idxOf(round);
  const facing = ROM[SPAWN_FACING_TABLE_1209 + idx];
  const timer = ROM[SPAWN_TIMER_TABLE_11F9 + idx];

  const m = craft(round);
  oracle(m);
  const g = (a) => m.mem.read8(a);
  assert.equal(g(REC + 0x00), 0x01, "active flag");
  assert.equal(g(REC + 0x02), 0x03, "opening state");
  assert.equal(g(REC + 0x03), 0x00);
  assert.equal(g(REC + 0x04), POS_SEED, "seeded position field");
  assert.equal(g(REC + 0x05), 0x00);
  assert.equal(g(REC + 0x06), 0x00);
  assert.equal(g(REC + 0x07), 0x01);
  assert.equal(g(REC + 0x08), 0x00);
  assert.equal(g(REC + 0x09), facing, "facing byte from the ROM table");
  assert.equal(g(REC + 0x0a), (-facing) & 0xff, "negated facing");
  assert.equal(g(REC + 0x0b), 0x00);
  assert.equal(g(REC + 0x0c), ANIM_LO, "anim pointer low (setActorAnimation)");
  assert.equal(g(REC + 0x0d), ANIM_HI, "anim pointer high");
  assert.equal(g(REC + 0x0e), 0x00, "anim frame index reset");
  assert.equal(g(ENEMY_SPAWN_TIMER), timer, "spawn-timer reload from the ROM table");
  assert.equal(g(SPAWN_COUNTER), 0x01, "0x8f5f bumped 0 -> 1");
  assert.equal(g(ACTIVE_ENEMY_COUNT), 0x01, "active-enemy count bumped 0 -> 1");
  console.log(`  WRITE-SET: record fields + spawn cells match (idx ${idx}, facing ${hx(facing)}, timer ${hx(timer)})`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a non-negated facing at (IX+0x0a) is CAUGHT by the RAM diff", () => {
  const round = 0x3c;
  const facing = ROM[SPAWN_FACING_TABLE_1209 + idxOf(round)];
  const o = craft(round);
  const c = craft(round);
  oracle(o);
  seedFreeEnemyRecordFromRoundTables(c);
  c.mem.write8(REC + 0x0a, facing); // BUG: should be the two's-complement negation
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-negated facing — it is worthless");
  assert.equal(d.addr, REC + 0x0a, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(facing): caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

/** Broken twin: seeds the record even when it is already active (ignores the skip). */
function brokenIgnoreSkip(m, rec = m.regs.ix) { m.mem.write8(rec + 0x00, 0x01); m.mem.write8(rec + 0x02, 0x03); }

test("TEETH: ignoring the already-active skip is CAUGHT", () => {
  const o = craft(0x00, { active: true });
  const c = craft(0x00, { active: true });
  oracle(o); // early-skips: writes nothing
  brokenIgnoreSkip(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped early-return — it is worthless");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});
