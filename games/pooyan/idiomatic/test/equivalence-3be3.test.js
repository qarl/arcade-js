// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyToArrivalAndTallyWave (Pooyan) — object state-6 handler. Ticks the record's
 * animation stream, then either homes toward a target (mode bit0 set: advance the position by the
 * velocity, nudge the row down when the position drops below the negated velocity, mirror position
 * and row into the linked record) or free-runs (mode bit0 clear: advance by the fixed step, carry
 * into the row). On arrival — the row reaching its mark — it bumps the wave/enemy tallies, blanks
 * the record's sprite band, and, when the band-kind high nibble is set, runs the gated lane reset
 * (latch + arrival-counter guarded), then the integrity check that bumps a tamper-strike slot.
 *
 * CYCLE-FREE / memory-equivalence gate. The routine WRITES RAM and calls memory-only helpers, so
 * every case uses a FRESH clone per side. Contract: RAM (dumpState minus stack scratch below the entry SP) ONLY — the
 * state dispatcher reads no result register, so there is no register live-out. pc/SP/cycles are NOT
 * compared. The nested calls push/pop in the dead stack (SP in STACK_SCRATCH).
 *
 * The record is based at IX and the leaf runs only during live object updates, so every case is
 * CRAFTED: the record (pre-dirtied to 0xAA so each write shows), the animation hold (set non-zero so
 * the animation tick just decrements), the mode/position/row/step/velocity/band fields, the linked
 * pointer, and the fixed game cells are all seated identically on both sides. The integrity check
 * reads a fixed program-memory window (identical on both sides), so its branch is deterministic.
 *
 * Jobs:
 *   1. EQUAL — homing/free-run, arrived/not-arrived, the carry-into-row case, and every arrival
 *      sub-path (band-blank tail, latch-blocked, counter-not-ready, full reset then flip/stage/
 *      integrity exits): advanceEnemyToArrivalAndTallyWave == oracle in RAM (−stack).
 *   2. WRITE-SET — the full-reset arrival path bumps the three tallies, blanks the band, steps the
 *      arrival counter, zeroes the four lane latches, and re-seeds the spawn timer + reset latch.
 *   3. TEETH — a lane-latch left un-zeroed, and a skipped wave-arrival bump, are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3be3.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3be3 as oracle } from "../../translated/loc_3be3.js";
import { advanceEnemyToArrivalAndTallyWave } from "../advanceEnemyToArrivalAndTallyWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import {
  STACK_SCRATCH,
  WAVE_ARRIVAL_COUNTER,
  ACTIVE_ENEMY_COUNT,
  WAVE_PROGRESS_COUNTER,
  LANE_RESET_LATCH,
  loc_8d76,
  LANE_SPAWN_COUNTDOWN,
  LAUNCH_ARM_LATCH,
  SCRIPT_ADVANCE_GUARD,
  SLOT_SWEEP_LATCH,
  ENEMY_SPAWN_TIMER,
  FLIP_SCREEN_FLAG,
  STAGE_COUNTDOWN,
  TAMPER_STRIKES_STATE0,
} from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; // work-RAM record base (IX); disjoint from the fixed game cells and the link
const LINK = 0x8bc0; // linked-record base pointed to by the record's pointer field
const REC_LEN = 0x18;
const FILL = 0xaa; // pre-dirty pattern so every write is visible

// record offsets
const HOLD = 0x0e, MODE_FLAG = 0x08, POSITION = 0x05, ROW = 0x06;
const FREE_STEP = 0x09, HOMING_VEL = 0x0a, BAND_KIND = 0x07, LINK_LO = 0x14, LINK_HI = 0x15;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ff0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone: record + link + touched game cells pre-dirtied, then the scenario seated. */
function craft(scn) {
  const m = BASE.clone();
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, FILL);
  for (let i = 0; i < 0x08; i++) m.mem.write8(LINK + i, FILL);
  m.mem.write8(REC + HOLD, 0x05); // non-zero: the animation tick just decrements this
  m.mem.write8(REC + MODE_FLAG, scn.mode);
  m.mem.write8(REC + POSITION, scn.pos);
  m.mem.write8(REC + ROW, scn.row);
  m.mem.write8(REC + FREE_STEP, scn.step ?? 0x00);
  m.mem.write8(REC + HOMING_VEL, scn.vel ?? 0x00);
  m.mem.write8(REC + BAND_KIND, scn.band ?? 0x00);
  m.mem.write8(REC + LINK_LO, LINK & 0xff);
  m.mem.write8(REC + LINK_HI, LINK >> 8);
  // fixed cells the routine may touch: counters pre-dirtied, gates set per scenario
  m.mem.write8(WAVE_ARRIVAL_COUNTER, FILL);
  m.mem.write8(ACTIVE_ENEMY_COUNT, FILL);
  m.mem.write8(WAVE_PROGRESS_COUNTER, FILL);
  m.mem.write8(LANE_SPAWN_COUNTDOWN, FILL);
  m.mem.write8(LAUNCH_ARM_LATCH, FILL);
  m.mem.write8(SCRIPT_ADVANCE_GUARD, FILL);
  m.mem.write8(SLOT_SWEEP_LATCH, FILL);
  m.mem.write8(ENEMY_SPAWN_TIMER, FILL);
  m.mem.write8(TAMPER_STRIKES_STATE0, scn.strikes ?? 0x10);
  m.mem.write8(LANE_RESET_LATCH, scn.latch ?? 0x00);
  m.mem.write8(loc_8d76, scn.counter ?? 0x00);
  m.mem.write8(FLIP_SCREEN_FLAG, scn.flip ?? 0x01);
  m.mem.write8(STAGE_COUNTDOWN, scn.stage ?? 0x20);
  m.regs.ix = REC;
  m.regs.sp = 0x8ff0; // dead stack
  return m;
}

const CASES = [
  { name: "homing, not arrived", mode: 0x01, vel: 0x00, pos: 0x40, row: 0x03 },
  { name: "homing, arrived -> band-blank tail", mode: 0x01, vel: 0x00, pos: 0x40, row: 0x00, band: 0x00 },
  { name: "free-run, not arrived", mode: 0x00, step: 0x10, pos: 0x00, row: 0x05 },
  { name: "free-run, arrived -> band-blank tail", mode: 0x00, step: 0x00, pos: 0x00, row: 0x1f, band: 0x00 },
  { name: "free-run, carry bumps row -> arrived", mode: 0x00, step: 0xff, pos: 0x01, row: 0x1e, band: 0x00 },
  { name: "arrival, high nibble, latch blocks", mode: 0x00, step: 0x00, pos: 0x00, row: 0x1f, band: 0x10, latch: 0x01 },
  { name: "arrival, high nibble, counter not ready", mode: 0x00, step: 0x00, pos: 0x00, row: 0x1f, band: 0x20, latch: 0x00, counter: 0x00 },
  { name: "arrival, full reset, flip blocks", mode: 0x00, step: 0x00, pos: 0x00, row: 0x1f, band: 0x30, latch: 0x00, counter: 0x01, flip: 0x01 },
  { name: "arrival, full reset, stage blocks", mode: 0x00, step: 0x00, pos: 0x00, row: 0x1f, band: 0x40, latch: 0x00, counter: 0x01, flip: 0x00, stage: 0x20 },
  { name: "arrival, full reset, integrity check runs", mode: 0x00, step: 0x00, pos: 0x00, row: 0x1f, band: 0x50, latch: 0x00, counter: 0x01, flip: 0x00, stage: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every branch — advanceEnemyToArrivalAndTallyWave == oracle in RAM (−stack)", () => {
  for (const scn of CASES) {
    const o = craft(scn);
    const c = craft(scn);
    oracle(o);
    advanceEnemyToArrivalAndTallyWave(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${scn.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted branch cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full-reset arrival path bumps tallies, blanks the band, and re-seeds the lane", () => {
  const scn = CASES[7]; // full reset, flip blocks before the integrity check (deterministic)
  const c = craft(scn);
  advanceEnemyToArrivalAndTallyWave(c);

  assert.equal(c.mem.read8(WAVE_ARRIVAL_COUNTER), (FILL + 1) & 0xff, "wave-arrival tally bumped");
  assert.equal(c.mem.read8(ACTIVE_ENEMY_COUNT), (FILL - 1) & 0xff, "active-enemy tally decremented");
  assert.equal(c.mem.read8(WAVE_PROGRESS_COUNTER), (FILL + 1) & 0xff, "wave-progress tally bumped");
  assert.equal(c.mem.read8(loc_8d76), 0x02, "arrival counter stepped to the ready threshold");
  assert.equal(c.mem.read8(LANE_SPAWN_COUNTDOWN), 0x00, "lane spawn countdown zeroed");
  assert.equal(c.mem.read8(LAUNCH_ARM_LATCH), 0x00, "launch-arm latch zeroed");
  assert.equal(c.mem.read8(SCRIPT_ADVANCE_GUARD), 0x00, "script-advance guard zeroed");
  assert.equal(c.mem.read8(SLOT_SWEEP_LATCH), 0x00, "slot-sweep latch zeroed");
  assert.equal(c.mem.read8(ENEMY_SPAWN_TIMER), 0x02, "spawn timer re-seeded to 2");
  assert.equal(c.mem.read8(LANE_RESET_LATCH), 0x02, "lane reset latch armed to 2");
  for (let i = 0; i <= 0x16; i++) assert.equal(c.mem.read8(REC + i), 0x00, `record band byte ${hx(i)} blanked`);
  console.log("  WRITE-SET: tallies bumped, band blanked, four latches zeroed, timer+latch re-seeded");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a lane latch left un-zeroed is CAUGHT by the RAM diff", () => {
  const scn = CASES[7];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceEnemyToArrivalAndTallyWave(c);
  c.mem.write8(LANE_SPAWN_COUNTDOWN, FILL); // BUG: the reset must zero this cell

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch an un-zeroed lane latch — it is worthless");
  assert.equal(d.addr, LANE_SPAWN_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: un-zeroed lane latch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a skipped wave-arrival bump is CAUGHT by the RAM diff", () => {
  const scn = CASES[7];
  const o = craft(scn);
  const c = craft(scn);
  oracle(o);
  advanceEnemyToArrivalAndTallyWave(c);
  c.mem.write8(WAVE_ARRIVAL_COUNTER, FILL); // BUG: arrival must have bumped this tally

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a skipped wave-arrival bump — it is worthless");
  assert.equal(d.addr, WAVE_ARRIVAL_COUNTER, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: skipped wave-arrival bump caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
