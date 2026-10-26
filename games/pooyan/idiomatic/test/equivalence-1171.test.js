// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickSpawnTimerAndSeedFreeEnemy (ROM 0x1171, Pooyan) — enemy spawn-cadence tick.
 *
 * tickSpawnTimerAndSeedFreeEnemy is the CALLER of the caller-skip seedFreeEnemyRecordFromRoundTables. In the oracle its record sweep calls 0x119a
 * per record; when 0x119a seeds a free record it does `pop af; ret` (a skip that aborts the sweep
 * and returns from tickSpawnTimerAndSeedFreeEnemy). The idiomatic caller drops the stack plumbing: it imports the
 * idiomatic seedFreeEnemyRecordFromRoundTables and `if (!seedFreeEnemyRecordFromRoundTables(...)) return;` — false (the seed path) aborts the sweep.
 *
 * This composes the REAL idiomatic seedFreeEnemyRecordFromRoundTables. The skip-taken arm therefore REQUIRES seedFreeEnemyRecordFromRoundTables to be
 * a boolean-returning module (true = the `ret c` already-active path, false = the `pop af; ret`
 * seed path). seedFreeEnemyRecordFromRoundTables was decompiled in an earlier leaves-first pass and currently returns
 * undefined on both paths — until it is re-dissolved to a boolean, the SKIP-TAKEN-MID-SWEEP arm
 * fails (the caller aborts after the first record instead of at the first FREE record). See the
 * agent notes for tickSpawnTimerAndSeedFreeEnemy.
 *
 * This is the cycle-free / memory-equivalence gate. The oracle reaches 0x119a (and its 0x381e /
 * 0x0020 callees) through m.call trampolines whose pushes — and 0x119a's skip-pop — land in
 * STACK_SCRATCH (sp seated there) and are excluded; the module calls the idiomatic sibling
 * directly. The contract compared is RAM (dumpState, minus stack scratch below the entry SP). serviceEnemySpawns reads no
 * register back (it calls this then unconditionally rets), so there is no register live-out and no
 * boolean is returned; RAM is the whole contract.
 *
 * Jobs:
 *   1. EQUAL — countdown (timer nonzero, no sweep), all-records-active (sweep completes, no seed),
 *      and skip-taken-mid-sweep (records 0,1 active, record 2 free -> only record 2 is seeded then
 *      the sweep aborts): oracle == tickSpawnTimerAndSeedFreeEnemy in RAM (−stack) on each.
 *   2. WRITE-SET — the countdown case's only write is the timer decrement.
 *   3. TEETH — a twin that fails to abort the sweep (seeds a later free record too) is caught by
 *      the RAM diff; a twin with a wrong decremented timer is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-1171.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_1171 as oracle } from "../../translated/loc_1171.js";
import { tickSpawnTimerAndSeedFreeEnemy } from "../tickSpawnTimerAndSeedFreeEnemy.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SPAWN_TIMER = 0x8d07;
const STAGE = 0x8901;
const ACTIVE = 0x8d40;
const RECORDS = 0x8ae0; // ENEMY_ACTOR_TABLE
const STRIDE = 0x18;
const rec = (i) => RECORDS + i * STRIDE;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fe0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the guard cells; make each record in `active` already-active (odd id -> seedFreeEnemyRecordFromRoundTables skips it). */
function craft({ timer, stage = 0x20, active = 0, activeRecords = [] }) {
  const m = BASE.clone();
  m.regs.sp = 0x8fe0; // in STACK_SCRATCH: the m.call pushes + seedFreeEnemyRecordFromRoundTables's skip-pop hit dead RAM
  m.mem.write8(SPAWN_TIMER, timer);
  m.mem.write8(STAGE, stage);
  m.mem.write8(ACTIVE, active);
  for (const r of activeRecords) m.mem.write8(rec(r), 0x01); // odd id byte -> "already active"
  return m;
}

const COUNTDOWN = { timer: 0x05 };                                   // timer nonzero: just decrement
const ALL_ACTIVE = { timer: 0, activeRecords: [0, 1, 2, 3, 4, 5] };  // sweep completes, seeds nothing
const SKIP_MID = { timer: 0, activeRecords: [0, 1] };                // records 0,1 active; record 2 is the first free

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: countdown — tickSpawnTimerAndSeedFreeEnemy == oracle in RAM (−stack)", () => {
  const o = craft(COUNTDOWN);
  const c = craft(COUNTDOWN);
  oracle(o);
  tickSpawnTimerAndSeedFreeEnemy(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(SPAWN_TIMER), 0x04, "timer decremented to 4");
  console.log("  EQUAL/countdown: identical (RAM −stack), timer 5 -> 4");
});

test("EQUAL: all records active — sweep completes, seeds nothing", () => {
  const o = craft(ALL_ACTIVE);
  const c = craft(ALL_ACTIVE);
  oracle(o);
  tickSpawnTimerAndSeedFreeEnemy(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL/all-active: identical (RAM −stack), no record seeded");
});

test("EQUAL: skip taken mid-sweep — only the first FREE record (2) is seeded [requires boolean seedFreeEnemyRecordFromRoundTables]", () => {
  const o = craft(SKIP_MID);
  const c = craft(SKIP_MID);
  oracle(o);
  tickSpawnTimerAndSeedFreeEnemy(c);
  const d = ramDiffMinusStack(o, c);
  assert.equal(
    d,
    null,
    d &&
      `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}. If this points at ${hx(rec(2))} ` +
      `the module aborted at record 0 — seedFreeEnemyRecordFromRoundTables must return a boolean (true=already-active, false=seeded).`,
  );
  // The oracle seeds record 2 (first free); records 3..5 stay untouched.
  assert.equal(o.mem.read8(rec(2)), 0x01, "sanity: oracle seeded record 2 active");
  assert.equal(o.mem.read8(rec(3)), 0x00, "sanity: oracle left record 3 untouched (sweep aborted)");
  console.log(`  EQUAL/skip-mid: identical (RAM −stack), record ${hx(rec(2))} seeded, sweep aborted`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the countdown case's only write is the timer decrement", () => {
  const o = craft(COUNTDOWN);
  const before = o.dumpState();
  oracle(o);
  const after = o.dumpState();

  const changed = [];
  for (let off = 0; off < before.length; off++) {
    if (before[off] !== after[off]) {
      const addr = o.stateOffsetToAddr(off);
      if (inDeadStack(addr)) continue;
      changed.push({ addr, from: before[off], to: after[off] });
    }
  }
  assert.equal(changed.length, 1, `expected exactly 1 write, got ${changed.length}`);
  assert.equal(changed[0].addr, SPAWN_TIMER, `the write must be the spawn timer (${hx(SPAWN_TIMER)})`);
  assert.equal(changed[0].to, 0x04, "timer 5 -> 4");
  console.log(`  WRITE-SET: only ${hx(SPAWN_TIMER)} := 4`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a failure to abort the sweep (a later free record seeded too) is CAUGHT", () => {
  const o = craft(SKIP_MID);
  const c = craft(SKIP_MID);
  oracle(o);
  tickSpawnTimerAndSeedFreeEnemy(c);
  c.mem.write8(rec(3), 0x01); // BUG: a caller that did not abort would seed record 3 as well

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a non-aborting sweep — it is worthless");
  assert.equal(d.addr, rec(3), `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(rec(3))})`);
  console.log(`  TEETH/abort: an extra seed at ${hx(d.addr)} caught (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong decremented timer is CAUGHT by the RAM diff", () => {
  const o = craft(COUNTDOWN);
  const c = craft(COUNTDOWN);
  oracle(o);
  tickSpawnTimerAndSeedFreeEnemy(c);
  c.mem.write8(SPAWN_TIMER, 0x03); // BUG: must be 4, not 3

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong timer — it is worthless");
  assert.equal(d.addr, SPAWN_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)} (expected ${hx(SPAWN_TIMER)})`);
  console.log(`  TEETH/RAM: wrong timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
