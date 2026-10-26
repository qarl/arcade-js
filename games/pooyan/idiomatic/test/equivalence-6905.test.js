// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnPairedEnemyOnDelaySweep (ROM 0x6905) — the delay-gated enemy spawn sweep, the
 * CALLER that composes the real idiomatic caller-skip spawnPairedEnemyRecordAndAnnounceWave (which itself composes
 * setActorAnimation, enqueueDisplayCommand and queueRoundSoundCommandRun).
 *
 * spawnPairedEnemyOnDelaySweep gates on the shared frame-delay timer, then on the wave-arrival / wave-limit checks,
 * then walks eight enemy/state record pairs, spawning into the FIRST empty one and stopping —
 * spawnPairedEnemyRecordAndAnnounceWave's `pop af; ret` skip aborts the sweep, so at most one pair spawns per call. The
 * idiomatic driver reproduces that with `if (!spawnPairedEnemyRecordAndAnnounceWave(...)) return;`.
 *
 * ⚠ THE FROZEN ORACLE IS BUGGY HERE. The translated spawnPairedEnemyOnDelaySweep has no skip-propagation guard
 * (unlike its sibling scanActorCollisionsBothSlots, which carries `if (m.pc !== <ret>) return`), so after spawnPairedEnemyRecordAndAnnounceWave's
 * `pop af; ret` the JS loop keeps running and spawns EVERY empty pair — all eight from an
 * all-empty state (verified: WAVE_NUMBER 3 -> 11). Correct hardware spawns exactly one; the
 * dissolution restores that. So oracle and the (correct) module agree ONLY when every pair after
 * the first empty one is already active — the oracle's runaway sweep then no-ops those actives and
 * lands the same single spawn. The EQUAL job stays inside that agreement region; the ABORT job
 * seats a two-empty state and asserts the module aborts (one spawn) WHILE the oracle over-spawns,
 * documenting the exact divergence the dissolution corrects.
 *
 * Oracle drives the TRANSLATED subtree through the routines map; the module drives the IDIOMATIC
 * subtree by direct import. spawnPairedEnemyOnDelaySweep returns void; registers are loop bookkeeping and are NOT
 * compared. Cases are CRAFTED: a plain boot does not seat these record inputs directly.
 *
 * Jobs:
 *   1. EQUAL (agreement region) — delay-gate, wave-done, wave-limit, all-active, first-empty-then-
 *      active (incl. the WAVE_NUMBER==0 HUD paint), and a mid-sweep spawn: oracle == module in RAM
 *      (−stack).
 *   2. ABORT — a two-empty state: the module spawns pair 0 and leaves pair 1 untouched; the buggy
 *      oracle spawns both. The module's single spawn is the correct hardware behaviour.
 *   3. TEETH — a wrong record byte is caught by the RAM diff; a no-abort twin (that spawns the bait
 *      pair) is caught against the correct module.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6905.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6905 as oracle } from "../../translated/loc_6905.js";
import { spawnPairedEnemyOnDelaySweep } from "../spawnPairedEnemyOnDelaySweep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8929; // SHARED_FRAME_DELAY_TIMER
const WAVE = 0x892d; // WAVE_NUMBER
const ARR = 0x8903; // WAVE_ARRIVAL_COUNTER
const IX_BASE = 0x8ae0; // ENEMY_ACTOR_TABLE
const IY_BASE = 0x8ba0; // OBJECT_STATE_RECORD_BASE
const STRIDE = 0x18; // record stride in each table
const SP0 = 0x8fe0; // inside STACK_SCRATCH; room for the sweep's nested-call dips
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ixOf = (n) => IX_BASE + n * STRIDE;

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** All eight pairs active, timer clear, a mid-wave state that lets the sweep run. */
function seatAllActive() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(DELAY, 0x00);
  m.mem.write8(WAVE, 0x03);
  m.mem.write8(ARR, 0x05);
  for (let n = 0; n < 8; n++) {
    m.mem.write8(ixOf(n) + 0, 0x01); // active
    m.mem.write8(ixOf(n) + 1, 0x00);
  }
  return m;
}

/** Mark one pair empty (spawnable). */
function makeEmpty(m, n) {
  m.mem.write8(ixOf(n) + 0, 0x00);
  m.mem.write8(ixOf(n) + 1, 0x00);
}

function craftAllActive() {
  return seatAllActive();
}
function craftSpawnPair0() {
  const m = seatAllActive();
  makeEmpty(m, 0); // first empty; pairs 1..7 active -> agreement
  return m;
}
function craftSpawnPair2() {
  const m = seatAllActive();
  makeEmpty(m, 2); // pairs 0,1 active, spawn at 2, pairs 3..7 active
  return m;
}
function craftFirstSpawn() {
  const m = seatAllActive();
  m.mem.write8(WAVE, 0x00); // first spawn of the wave -> the HUD paint runs
  makeEmpty(m, 0);
  return m;
}
function craftDelayGate() {
  const m = seatAllActive();
  m.mem.write8(DELAY, 0x05); // timer running -> decrement only
  makeEmpty(m, 0); // present but never reached under the gate
  return m;
}
function craftWaveDone() {
  const m = seatAllActive();
  m.mem.write8(WAVE, 0x05); // == ARR -> return before the sweep
  makeEmpty(m, 0);
  return m;
}
function craftWaveLimit() {
  const m = seatAllActive();
  m.mem.write8(WAVE, 0x08); // >= limit -> return before the sweep
  m.mem.write8(ARR, 0x02);
  makeEmpty(m, 0);
  return m;
}

// -- 1. EQUAL (agreement region) ----------------------------------------------

for (const [label, craft] of [
  ["all-active", craftAllActive],
  ["spawn-pair0", craftSpawnPair0],
  ["spawn-pair2 (mid-sweep)", craftSpawnPair2],
  ["first-spawn + HUD paint", craftFirstSpawn],
  ["delay-gate", craftDelayGate],
  ["wave-done", craftWaveDone],
  ["wave-limit", craftWaveLimit],
]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    spawnPairedEnemyOnDelaySweep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: RAM identical`);
  });
}

// -- 2. ABORT -----------------------------------------------------------------

test("ABORT: two empty pairs — module AND the guard-fixed oracle both spawn one and abort the sweep", () => {
  const c = seatAllActive();
  makeEmpty(c, 0);
  makeEmpty(c, 1); // bait: a runaway sweep would spawn this too
  spawnPairedEnemyOnDelaySweep(c);

  assert.equal(c.mem.read8(ixOf(0)), 0x01, "module: pair 0 spawned");
  assert.equal(c.mem.read8(ixOf(1)), 0x00, "module: pair 1 left untouched -> the skip aborted the sweep");
  assert.equal(c.mem.read8(WAVE), 0x04, "module: exactly one spawn bumped WAVE_NUMBER once");

  const o = seatAllActive();
  makeEmpty(o, 0);
  makeEmpty(o, 1);
  oracle(o);
  // Oracle now carries the caller-skip guard (MAME-confirmed one-spawn); it aborts the sweep too, so
  // this previously-divergent multi-empty case is now fully RAM-equivalent to the module.
  assert.equal(o.mem.read8(ixOf(1)), 0x00, "oracle (guard-fixed): pair 1 untouched -> the skip aborts the sweep");
  assert.equal(o.mem.read8(WAVE), 0x04, "oracle: exactly one spawn (matches the module)");
  const d = ramDiffMinusStack(o, c);
  assert.equal(d, null, d && `multi-empty RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  console.log("  ABORT: module == guard-fixed oracle — one spawn, sweep aborted");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong record byte is caught by the RAM diff (agreement scenario)", () => {
  const o = craftSpawnPair0();
  const c = craftSpawnPair0();
  oracle(o);
  spawnPairedEnemyOnDelaySweep(c);
  c.mem.write8(ixOf(0) + 0x04, 0x99); // BUG: field 0x04 must be 0x15

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "gate FAILED to catch a wrong record byte — worthless");
  assert.equal(d.addr, ixOf(0) + 0x04, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong record byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a no-abort twin (spawns the bait pair) is caught against the correct module", () => {
  const good = seatAllActive();
  makeEmpty(good, 0);
  makeEmpty(good, 1);
  spawnPairedEnemyOnDelaySweep(good);

  const twin = seatAllActive();
  makeEmpty(twin, 0);
  makeEmpty(twin, 1);
  spawnPairedEnemyOnDelaySweep(twin);
  twin.mem.write8(ixOf(1), 0x01); // simulate a driver that failed to abort and spawned pair 1

  const d = ramDiffMinusStack(good, twin);
  assert.notEqual(d, null, "gate FAILED to catch a runaway (no-abort) sweep — worthless");
  assert.equal(d.addr, ixOf(1), `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(ixOf(1))})`);
  console.log(`  TEETH/abort: a runaway pair-1 spawn caught at ${hx(d.addr)}`);
});
