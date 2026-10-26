// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnHunterIntoFreeSlot (ROM 0x118d) — "sweep a run of actor records, initialise the
 * first free one." For up to B records a 0x18 stride apart it hands each to the per-record initialiser
 * (seedFreeEnemyRecordFromRoundTables) with a fixed 0x1d seed; the first free record is seeded and the sweep ends there.
 *
 * The initialiser aborts the sweep in the original with a pop-af skip-return, which the ORACLE models
 * by popping the stack while its JS loop keeps running — so after a seed the oracle's djnz counter is
 * reloaded from C and the loop drains that many more (no-op) turns. Seating C = 1 makes that djnz fall
 * to zero the turn after any seed, so the oracle seeds exactly the first free record and stops, exactly
 * as the idiomatic form (which returns on the first false) and the hardware do. That is the input
 * domain where the oracle faithfully represents the machine, so every case seats C = 1.
 *
 * Compared on RAM (dumpState) minus stack scratch below the entry SP — the oracle's push/pop trampolines live there and
 * fall out of the diff; the idiomatic side never touches the machine stack. No register live-out.
 *
 * Jobs: 1. EQUAL across no-seed / first-slot / mid-run / last-slot sweeps; 2. WRITE-SET (the first
 * free record is seeded, a later free record is left untouched — the sweep stops); 3. TEETH (a
 * corrupted seed byte is caught; seed vs no-seed branches differ).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-118d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_118d as oracle } from "../../translated/loc_118d.js";
import { spawnHunterIntoFreeSlot } from "../spawnHunterIntoFreeSlot.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  ENEMY_ACTOR_TABLE,
  ROUND_COUNTER,
  ACTIVE_ENEMY_COUNT,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = ENEMY_ACTOR_TABLE;
const STRIDE = 0x18;
const COUNT = 6;
const SEED = 0x1d; // the +4 field stamped into an initialised record
const OPENING_STATE = 0x03; // the +2 field stamped into an initialised record
const SP0 = 0x8fe0; // inside STACK_SCRATCH, with headroom for the oracle's nested pushes
const recAddr = (i) => (REC + i * STRIDE) & 0xffff;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat B/IX/C and mark each of the six records active (odd id bytes) or free (even). */
function seat(activeSlots) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.b = COUNT;
  m.regs.c = 0x01; // activation index; 1 collapses the oracle's post-seed djnz to a single turn
  m.regs.sp = SP0;
  m.mem.write8(ROUND_COUNTER, 0x00); // deterministic table index for the seed path
  for (let i = 0; i < COUNT; i++) {
    const active = activeSlots.includes(i);
    m.mem.write8(recAddr(i), active ? 0x01 : 0x00);
    m.mem.write8(recAddr(i) + 1, active ? 0x01 : 0x00);
  }
  return m;
}

const CASES = [
  { name: "all active -> no seed", active: [0, 1, 2, 3, 4, 5], seededSlot: null },
  { name: "all free -> seed slot 0, stop", active: [], seededSlot: 0 },
  { name: "slot 0 active -> seed slot 1, stop", active: [0], seededSlot: 1 },
  { name: "slots 0-4 active -> seed slot 5", active: [0, 1, 2, 3, 4], seededSlot: 5 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: spawnHunterIntoFreeSlot == oracle in RAM (−stack) across every sweep outcome", () => {
  for (const { name, active } of CASES) {
    const o = seat(active);
    const c = seat(active);
    oracle(o);
    spawnHunterIntoFreeSlot(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} idiom=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} sweep outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the first free record is seeded; a later free record is left alone", () => {
  // slot 0 active, slots 1..5 free -> the sweep must seed slot 1 and stop before slot 2.
  const c = seat([0]);
  spawnHunterIntoFreeSlot(c);

  assert.equal(c.mem.read8(recAddr(1)), 0x01, "first free record marked active");
  assert.equal(c.mem.read8(recAddr(1) + 0x02), OPENING_STATE, "first free record given the opening state");
  assert.equal(c.mem.read8(recAddr(1) + 0x04), SEED, "first free record seeded with 0x1d");
  assert.equal(c.mem.read8(recAddr(2)), 0x00, "the sweep stopped: slot 2 was NOT seeded");
  assert.equal(c.mem.read8(recAddr(0)), 0x01, "the pre-active slot 0 is untouched");
  console.log(`  WRITE-SET: slot 1 seeded (+0:=1,+2:=3,+4:=0x1d); slot 2 untouched (sweep stopped)`);
});

test("WRITE-SET: an all-active run writes nothing", () => {
  const before = seat([0, 1, 2, 3, 4, 5]);
  const after = seat([0, 1, 2, 3, 4, 5]);
  const b0 = before.dumpState();
  spawnHunterIntoFreeSlot(after);
  const a1 = after.dumpState();
  let changed = 0;
  for (let off = 0; off < b0.length; off++) if (b0[off] !== a1[off]) changed++;
  assert.equal(changed, 0, "an all-active sweep must leave RAM unchanged");
  console.log("  WRITE-SET: all-active sweep writes zero cells");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted seed byte is CAUGHT by the RAM diff", () => {
  const o = seat([0]);
  const c = seat([0]);
  oracle(o);
  spawnHunterIntoFreeSlot(c);
  c.mem.write8(recAddr(1) + 0x04, (o.mem.read8(recAddr(1) + 0x04) ^ 0xff) & 0xff); // BUG: wrong seed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted seed byte — it is worthless");
  assert.equal(d.addr, recAddr(1) + 0x04, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH: corrupted seed caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a continued sweep (no abort) would diverge — stop-after-first is load-bearing", () => {
  // All free: the oracle (C=1) seeds only slot 0. A sweep that failed to stop would seed slot 1 too;
  // forge that here and confirm the RAM diff rejects it.
  const o = seat([]);
  const c = seat([]);
  oracle(o);
  spawnHunterIntoFreeSlot(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: idiomatic matches the oracle (seed slot 0 only)");
  c.mem.write8(recAddr(1) + 0x04, SEED); // forge a second seed as if the sweep never aborted
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a non-aborting sweep must diverge from the oracle");
  console.log(`  TEETH: a second seed at ${hx(recAddr(1))} rejected — abort is load-bearing`);
});

test("TEETH: seed and no-seed branches produce different RAM", () => {
  const seedRun = seat([]); // seeds slot 0
  const noSeed = seat([0, 1, 2, 3, 4, 5]); // seeds nothing
  oracle(seedRun);
  oracle(noSeed);
  assert.notEqual(ramDiffMinusStack(seedRun, noSeed), null, "seed vs no-seed sweeps must differ");
  // corroborate the seed actually bumped the active-enemy counter
  assert.equal(
    (noSeed.mem.read8(ACTIVE_ENEMY_COUNT) + 1) & 0xff,
    seedRun.mem.read8(ACTIVE_ENEMY_COUNT),
    "a seed bumps ACTIVE_ENEMY_COUNT",
  );
  console.log("  TEETH: seed vs no-seed RAM differs; a seed bumps the active-enemy count");
});
