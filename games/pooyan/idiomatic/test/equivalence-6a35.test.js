// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnEnemyIntoFreeSlotCyclingAnim (ROM 0x6a35) — the per-record enemy spawn/init, a
 * DISSOLVED caller-skip that composes the idiomatic setActorAnimation.
 *
 * A record already carrying the active bit takes the plain `ret c` (normal return, SP += 2)
 * and the module returns true, so the sweeping caller keeps going. The first empty record is
 * spawned into: the module seeds the record, arms the spawn-delay countdown, bumps the phase
 * toggle, picks the spawn animation pointer by the pre-bump phase, points the record at it,
 * then FALLS INTO the shared `pop af; ret` that unwinds the caller (SP += 4); the module
 * returns false.
 *
 * The oracle drives the TRANSLATED setActorAnimation (0x381e) through the routines map; the
 * module imports the IDIOMATIC sibling directly. The two must land byte-identical in RAM
 * (dumpState) minus stack scratch below the entry SP. No register is a live-out — the caller parks its loop
 * bookkeeping across the call and the skip's `pop af` loads stack scratch — so registers are
 * NOT compared. The boolean return is, and the oracle's SP delta confirms which path ran.
 *
 * Cases are CRAFTED: a plain boot does not seat this record/phase state directly.
 *
 * Jobs:
 *   1. EQUAL — already-active and four spawn phases (0/1/2/3): oracle == module in RAM
 *      (−stack); boolean matches (true active / false spawn); oracle SP delta matches the path.
 *   2. WRITE-SET — a spawn seeds the record fields, its animation cells, the countdown, and
 *      bumps the phase toggle; phase 1 re-arms the countdown to a larger value.
 *   3. TEETH — a twin that reports the spawn as 'continue' (true) is rejected; a wrong seeded
 *      record byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6a35.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6a35 as oracle } from "../../translated/loc_6a35.js";
import { spawnEnemyIntoFreeSlotCyclingAnim } from "../spawnEnemyIntoFreeSlotCyclingAnim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const COUNTDOWN = 0x892a; // BLINK_COUNTDOWN (spawn-delay countdown)
const TOGGLE = 0x892c; // ANIM_PHASE_TOGGLE_892C (spawn phase)
const REC = 0x8ae0; // ENEMY_ACTOR_TABLE slot 0 (controllable record)
const SP0 = 0x8ff8; // inside STACK_SCRATCH; room for the effect-call push dip
const hx = (v) => "0x" + (v & 0xffff).toString(16);

// spawn animation pointers, by pre-bump phase
const PTR_EARLY = 0x76d4; // phase 0 or 1
const PTR_MID = 0x68ef; // phase 2
const PTR_LATE = 0x6b0a; // phase > 2

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seat(m) {
  m.regs.ix = REC;
  m.regs.sp = SP0;
  return m;
}

/** Record slot 0 carries the active bit (set via rec+1) -> the normal `ret c` path. */
function craftActive() {
  const m = seat(BASE.clone());
  m.mem.write8(REC + 0, 0x00);
  m.mem.write8(REC + 1, 0x01); // active bit set
  return m;
}

/** Record slot 0 carries the active bit via rec+0 -> exercises the OR half of the test. */
function craftActiveLow() {
  const m = seat(BASE.clone());
  m.mem.write8(REC + 0, 0x01); // active bit set on the other byte
  m.mem.write8(REC + 1, 0x00);
  return m;
}

/** Record slot 0 empty; TOGGLE = `phase` -> the spawn path with that phase's pointer. */
function craftSpawn(phase) {
  const m = seat(BASE.clone());
  m.mem.write8(REC + 0, 0x00);
  m.mem.write8(REC + 1, 0x00); // empty -> spawn
  m.mem.write8(TOGGLE, phase & 0xff);
  m.mem.write8(COUNTDOWN, 0x00); // known start so the arm/re-arm is observable
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

for (const [label, craft] of [["active", craftActive], ["active-low", craftActiveLow]]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack), returns true, normal ret (SP+=2)`, () => {
    const o = craft();
    const c = craft();
    const ret = spawnEnemyIntoFreeSlotCyclingAnim(c);
    oracle(o);

    assert.equal(ret, true, "an already-active record must return true (caller keeps sweeping)");
    assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle active must take the plain ret c (SP += 2)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    console.log(`  EQUAL ${label}: true, SP+=2, RAM identical`);
  });
}

for (const [phase, ptr] of [[0, PTR_EARLY], [1, PTR_EARLY], [2, PTR_MID], [3, PTR_LATE]]) {
  test(`EQUAL: spawn phase ${phase} — module == oracle in RAM (−stack), returns false, skip (SP+=4)`, () => {
    const o = craftSpawn(phase);
    const c = craftSpawn(phase);
    const ret = spawnEnemyIntoFreeSlotCyclingAnim(c);
    oracle(o);

    assert.equal(ret, false, "a spawn must return false (abort the caller)");
    assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle spawn must fall into the pop-af/ret skip (SP += 4)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (phase ${phase})`);
    // both landed the chosen animation pointer into the record's anim cells
    assert.equal(c.mem.read8(REC + 0x0c), ptr & 0xff, `phase ${phase}: anim ptr low`);
    assert.equal(c.mem.read8(REC + 0x0d), (ptr >> 8) & 0xff, `phase ${phase}: anim ptr high`);
    console.log(`  EQUAL spawn/phase ${phase}: false, SP+=4, RAM identical, ptr ${hx(ptr)}`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a spawn seeds the record, arms the countdown, points the anim, bumps the toggle", () => {
  const after = craftSpawn(0);
  oracle(after);

  assert.equal(after.mem.read8(REC + 1), 0x01, "rec+1 activated");
  assert.equal(after.mem.read8(REC + 2), 0x01, "rec+2 seeded");
  assert.equal(after.mem.read8(REC + 3), 0x00, "rec+3 cleared");
  assert.equal(after.mem.read8(REC + 4), 0x15, "rec+4 seeded");
  assert.equal(after.mem.read8(REC + 5), 0x00, "rec+5 cleared");
  assert.equal(after.mem.read8(REC + 6), 0x1e, "rec+6 seeded");
  assert.equal(after.mem.read8(REC + 9), 0x28, "rec+9 seeded");
  assert.equal(after.mem.read8(REC + 0x0e), 0x00, "anim frame index cleared");
  assert.equal(after.mem.read8(COUNTDOWN), 0x10, "phase 0 arms the countdown to 0x10 (no re-arm)");
  assert.equal(after.mem.read8(TOGGLE), 0x01, "phase toggle bumped 0 -> 1");
  console.log("  WRITE-SET: record seeded + countdown armed + toggle bumped");
});

test("WRITE-SET: spawn phase 1 re-arms the countdown to the larger value", () => {
  const after = craftSpawn(1);
  oracle(after);
  assert.equal(after.mem.read8(COUNTDOWN), 0x1c, "phase 1 re-arms the countdown to 0x1c");
  assert.equal(after.mem.read8(TOGGLE), 0x02, "phase toggle bumped 1 -> 2");
  console.log("  WRITE-SET: phase 1 re-armed countdown to 0x1c");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports the spawn as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    spawnEnemyIntoFreeSlotCyclingAnim(m); // real memory effect
    return true; // BUG: a spawn must abort the caller -> false
  }
  const c = craftSpawn(0);
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject a spawn reported as 'continue'",
  );
  console.log("  TEETH/boolean: a spawn-returns-true twin is caught");
});

test("TEETH: a wrong seeded record byte is caught by the RAM diff", () => {
  const o = craftSpawn(0);
  const c = craftSpawn(0);
  oracle(o);
  spawnEnemyIntoFreeSlotCyclingAnim(c);
  c.mem.write8(REC + 4, 0x99); // BUG: rec+4 must be 0x15

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a wrong seeded byte — worthless");
  assert.equal(d.addr, REC + 4, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
