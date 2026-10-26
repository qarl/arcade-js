// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnPairedEnemyRecordAndAnnounceWave (ROM 0x6931) — the per-record enemy spawn/init, a
 * DISSOLVED caller-skip that composes the idiomatic siblings setActorAnimation, enqueueDisplayCommand and
 * queueRoundSoundCommandRun.
 *
 * An already-active record pair takes the plain `ret c` (normal return, SP += 2) and the module
 * returns true (caller keeps sweeping). An empty pair is spawned; spawnPairedEnemyRecordAndAnnounceWave then FALLS INTO the
 * shared `pop af; ret` (SP += 4), unwinding the caller, and the module returns false. On the first
 * spawn of a wave (WAVE_NUMBER == 0) it additionally queues two display commands and paints the
 * arrival count as two BCD digits before bumping WAVE_NUMBER.
 *
 * The oracle runs the TRANSLATED subtree through the routines map; the idiomatic module imports the
 * IDIOMATIC siblings directly. The two must land byte-identical in RAM (dumpState) minus
 * stack scratch below the entry SP. No register is a live-out: the caller (spawnPairedEnemyOnDelaySweep) protects its own loop counter and
 * stride and advances IX/IY itself, so nothing the spawn leaves in registers is read back —
 * registers are NOT compared. The boolean return IS, and the oracle's SP delta (+2 normal / +4 skip)
 * confirms which path it took.
 *
 * Cases are CRAFTED: a plain boot does not seat this routine's IX/IY record inputs directly.
 *
 * Jobs:
 *   1. EQUAL — active, spawn-later and spawn-first (with HUD paint): oracle == module in RAM
 *      (−stack); boolean matches (true active / false spawn); oracle SP delta matches the path.
 *   2. WRITE-SET — a first spawn activates both records, seeds their fields, arms the delay, bumps
 *      WAVE_NUMBER, and paints the two BCD HUD digits.
 *   3. TEETH — a twin that reports a spawn as 'continue' (true) is rejected; a wrong seeded field
 *      byte is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6931.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6931 as oracle } from "../../translated/loc_6931.js";
import { spawnPairedEnemyRecordAndAnnounceWave } from "../spawnPairedEnemyRecordAndAnnounceWave.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8ae0; // ENEMY_ACTOR_TABLE — enemy record base (first pair)
const IY = 0x8ba0; // OBJECT_STATE_RECORD_BASE — paired state record base
const DELAY = 0x8929; // SHARED_FRAME_DELAY_TIMER
const WAVE = 0x892d; // WAVE_NUMBER
const ARR = 0x8903; // WAVE_ARRIVAL_COUNTER (the count painted on the first spawn)
const HUD_HI = 0x863b; // WAVE_COUNT_HUD_HI — high BCD digit tile
const HUD_LO = 0x861b; // low BCD digit tile (HUD_HI - 0x20)
const SP0 = 0x8fe0; // inside STACK_SCRATCH; room for the nested-call dips + the pop-af/ret
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function seat(m) {
  m.regs.ix = IX;
  m.regs.iy = IY;
  m.regs.sp = SP0;
  return m;
}

/** First two record bytes carry bit 0 -> the pair is already active. */
function craftActive() {
  const m = seat(BASE.clone());
  m.mem.write8(IX + 0, 0x01);
  m.mem.write8(IX + 1, 0x00);
  m.mem.write8(WAVE, 0x03);
  return m;
}

/** Empty pair, WAVE_NUMBER != 0 -> spawn without the first-spawn HUD paint. */
function craftSpawnLater() {
  const m = seat(BASE.clone());
  m.mem.write8(IX + 0, 0x00);
  m.mem.write8(IX + 1, 0x00);
  m.mem.write8(WAVE, 0x03);
  m.mem.write8(ARR, 0x05);
  m.mem.write8(DELAY, 0x00);
  return m;
}

/** Empty pair, WAVE_NUMBER == 0 -> spawn AND paint. ARR = 12 -> BCD 0x12 (hi 1 / lo 2). */
function craftSpawnFirst() {
  const m = seat(BASE.clone());
  m.mem.write8(IX + 0, 0x00);
  m.mem.write8(IX + 1, 0x00);
  m.mem.write8(WAVE, 0x00);
  m.mem.write8(ARR, 0x0c);
  m.mem.write8(DELAY, 0x00);
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: active — module == oracle in RAM (−stack), returns true, normal ret (SP += 2)", () => {
  const o = craftActive();
  const c = craftActive();
  const ret = spawnPairedEnemyRecordAndAnnounceWave(c);
  oracle(o);

  assert.equal(ret, true, "an already-active pair must return true (caller keeps sweeping)");
  assert.equal(o.regs.sp, (SP0 + 2) & 0xffff, "oracle active must take the plain ret c (SP += 2)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  EQUAL active: true, SP+=2, RAM identical (no spawn)");
});

for (const [label, craft] of [
  ["spawn-later", craftSpawnLater],
  ["spawn-first", craftSpawnFirst],
]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack), returns false, skip (SP += 4)`, () => {
    const o = craft();
    const c = craft();
    const ret = spawnPairedEnemyRecordAndAnnounceWave(c);
    oracle(o);

    assert.equal(ret, false, "a spawn must return false (abort the caller)");
    assert.equal(o.regs.sp, (SP0 + 4) & 0xffff, "oracle spawn must fall into the pop-af/ret skip (SP += 4)");
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: false, SP+=4, RAM identical (composed idiomatic subtree)`);
  });
}

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a first spawn activates both records, seeds fields, arms the delay, paints the HUD", () => {
  const after = craftSpawnFirst();
  oracle(after);

  assert.equal(after.mem.read8(IX + 0), 0x01, "enemy record activated");
  assert.equal(after.mem.read8(IY + 0), 0x01, "state record activated");
  assert.equal(after.mem.read8(IX + 0x04), 0x15, "IX field 0x04 seeded");
  assert.equal(after.mem.read8(IY + 0x10), 0x40, "IY field 0x10 seeded");
  assert.equal(after.mem.read8(IX + 0x0c), 0x38, "anim pointer low (0x3838)");
  assert.equal(after.mem.read8(IX + 0x0d), 0x38, "anim pointer high (0x3838)");
  assert.equal(after.mem.read8(IX + 0x0e), 0x00, "anim frame index cleared");
  assert.equal(after.mem.read8(DELAY), 0x10, "respawn delay armed");
  assert.equal(after.mem.read8(WAVE), 0x01, "WAVE_NUMBER bumped 0 -> 1");
  assert.equal(after.mem.read8(HUD_HI), 0x01, "HUD high digit (BCD of 12)");
  assert.equal(after.mem.read8(HUD_LO), 0x02, "HUD low digit (BCD of 12)");
  console.log("  WRITE-SET: records activated + fields + delay + WAVE bump + BCD digits confirmed");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a twin that reports a spawn as 'continue' (true) is rejected by the boolean check", () => {
  function brokenContinue(m) {
    spawnPairedEnemyRecordAndAnnounceWave(m, IX, IY); // real memory effect
    return true; // BUG: a spawn must abort the caller -> false
  }
  const c = craftSpawnLater();
  assert.throws(
    () => assert.equal(brokenContinue(c), false),
    "the boolean contract must reject a spawn reported as 'continue'",
  );
  console.log("  TEETH/boolean: a spawn-returns-true twin is caught");
});

test("TEETH: a wrong seeded field byte is caught by the RAM diff", () => {
  const o = craftSpawnLater();
  const c = craftSpawnLater();
  oracle(o);
  spawnPairedEnemyRecordAndAnnounceWave(c, IX, IY);
  c.mem.write8(IX + 0x04, 0x99); // BUG: field 0x04 must be 0x15

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a wrong seeded byte — worthless");
  assert.equal(d.addr, IX + 0x04, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong seeded byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
