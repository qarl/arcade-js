// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnEnemyOnBlinkCountdownSweep (ROM 0x6a0f) — the enemy-spawn sweep driver, the
 * CALLER that composes the idiomatic per-record spawn spawnEnemyIntoFreeSlotCyclingAnim (which composes the idiomatic
 * setActorAnimation).
 *
 * The driver first runs three gates: it does nothing while the blink phase is clear, while
 * the phase toggle equals its gate value, or while the spawn-delay countdown is non-zero
 * (that tick only decrements the countdown). With the gates open it sweeps the enemy-actor
 * records: an already-active record is skipped and the sweep continues; the first empty record
 * is spawned into, and in the frozen layer that record's spawn falls into a `pop af; ret` that
 * unwinds this driver — the idiomatic loop reproduces that with `if (!spawnEnemyIntoFreeSlotCyclingAnim(...)) return;`.
 *
 * ORACLE DEFECT (reported to the LEAD): translated/loc_6a0f.js does NOT propagate the skip
 * abort. It is missing the `if (m.pc !== 0x6a2f) return;` check that translated/loc_6404.js
 * carries after its own skip-call (scanActorCollisionsBothSlots.js line 34). Run directly, the caller oracle keeps
 * sweeping after the first spawn and spawns EVERY empty record, where hardware unwinds after
 * one. So this file:
 *   - diffs the raw caller oracle vs the module only on the paths the oracle gets right (the
 *     three gates + an all-active sweep, none of which take the skip);
 *   - grounds the abort behaviour on the spawnEnemyIntoFreeSlotCyclingAnim ORACLE (whose equivalence holds — see
 *     equivalence-6a35.test.js), driven record-by-record, as the correct reference;
 *   - captures the caller-oracle over-spawn as a defect tripwire that flips when the oracle is
 *     fixed, at which point the abort case can move into the raw-oracle diff loop.
 *
 * Fidelity contract: RAM (dumpState) minus stack scratch below the entry SP. spawnEnemyOnBlinkCountdownSweep returns void; registers are
 * loop bookkeeping and are NOT compared. Cases are CRAFTED.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-6a0f.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_6a0f as oracle } from "../../translated/loc_6a0f.js";
import { spawnEnemyOnBlinkCountdownSweep } from "../spawnEnemyOnBlinkCountdownSweep.js";
import { loc_6a35 as oracle35 } from "../../translated/loc_6a35.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const PHASE = 0x892b; // BLINK_PHASE (gate: sweep only when non-zero)
const TOGGLE = 0x892c; // ANIM_PHASE_TOGGLE_892C (gate: suspend at TOGGLE_GATE; also the spawn phase)
const COUNTDOWN = 0x892a; // BLINK_COUNTDOWN (gate: decrement while non-zero)
const TABLE = 0x8ae0; // ENEMY_ACTOR_TABLE (18 records, stride 0x18)
const STRIDE = 0x18;
const TOGGLE_GATE = 0x06;
const SP0 = 0x8ff8; // inside STACK_SCRATCH; room for the pushed frame + effect-call dips
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const rec = (n) => (TABLE + n * STRIDE) & 0xffff;

const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);

function ramDiffMinusStack(ma, mb) {
  const a = ma.dumpState();
  const b = mb.dumpState();
  return firstStateDiff(a, b, (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function base() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
}

/** Blink phase clear -> the driver returns before any gate work. */
function craftGatePhase() {
  const m = base();
  m.mem.write8(PHASE, 0x00);
  m.mem.write8(rec(0) + 1, 0x00); // empty — would spawn if the sweep ran
  return m;
}

/** Phase toggle at the gate value -> the driver returns. */
function craftGateToggle() {
  const m = base();
  m.mem.write8(PHASE, 0x01);
  m.mem.write8(TOGGLE, TOGGLE_GATE);
  m.mem.write8(rec(0) + 1, 0x00);
  return m;
}

/** Countdown still running -> the driver decrements it and returns. */
function craftGateCountdown() {
  const m = base();
  m.mem.write8(PHASE, 0x01);
  m.mem.write8(TOGGLE, 0x00);
  m.mem.write8(COUNTDOWN, 0x05); // -> 0x04, then return
  m.mem.write8(rec(0) + 1, 0x00);
  return m;
}

/** Gates open, every record already active -> the sweep visits all 18 and completes, no spawn. */
function craftSweepAllActive() {
  const m = base();
  m.mem.write8(PHASE, 0x01);
  m.mem.write8(TOGGLE, 0x00);
  m.mem.write8(COUNTDOWN, 0x00);
  for (let n = 0; n < 18; n++) {
    m.mem.write8(rec(n) + 0, 0x00);
    m.mem.write8(rec(n) + 1, 0x01); // active
  }
  return m;
}

/** Gates open, record 0 active, records 1.. empty -> skip 0, spawn 1, abort before record 2. */
function craftSpawnAbort() {
  const m = base();
  m.mem.write8(PHASE, 0x01);
  m.mem.write8(TOGGLE, 0x00); // phase 0 spawn -> deterministic pointer, arms countdown to 0x10
  m.mem.write8(COUNTDOWN, 0x00);
  m.mem.write8(rec(0) + 0, 0x00);
  m.mem.write8(rec(0) + 1, 0x01); // active -> skipped, sweep continues
  for (let n = 1; n < 18; n++) {
    m.mem.write8(rec(n) + 0, 0x00);
    m.mem.write8(rec(n) + 1, 0x00); // empty
  }
  return m;
}

/**
 * The CORRECT post-abort RAM, built from the spawnEnemyIntoFreeSlotCyclingAnim ORACLE (equivalence proven separately):
 * drive it over record 0 (already active -> normal ret, no writes) then record 1 (empty ->
 * spawn + skip), and stop — exactly what an abort-propagating caller would leave behind.
 */
function craftAbortReference() {
  const ref = craftSpawnAbort();
  ref.regs.ix = rec(0);
  ref.regs.sp = SP0;
  oracle35(ref); // record 0 active -> `ret c`, no memory effect
  ref.regs.ix = rec(1);
  ref.regs.sp = SP0;
  oracle35(ref); // record 1 empty -> spawn, then the skip aborts the caller
  return ref;
}

// -- 1. EQUAL (raw caller oracle, non-skip paths only) ------------------------

for (const [label, craft] of [
  ["gate-phase", craftGatePhase],
  ["gate-toggle", craftGateToggle],
  ["gate-countdown", craftGateCountdown],
  ["sweep-all-active", craftSweepAllActive],
]) {
  test(`EQUAL: ${label} — module == oracle in RAM (−stack)`, () => {
    const o = craft();
    const c = craft();
    oracle(o);
    spawnEnemyOnBlinkCountdownSweep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b} (${label})`);
    console.log(`  EQUAL ${label}: RAM identical (composed idiomatic spawnEnemyIntoFreeSlotCyclingAnim)`);
  });
}

test("EQUAL: gate-countdown decrements the countdown by one", () => {
  const o = craftGateCountdown();
  const c = craftGateCountdown();
  oracle(o);
  spawnEnemyOnBlinkCountdownSweep(c);
  assert.equal(c.mem.read8(COUNTDOWN), 0x04, "module: countdown 0x05 -> 0x04");
  assert.equal(o.mem.read8(COUNTDOWN), 0x04, "oracle: countdown 0x05 -> 0x04");
  console.log("  EQUAL gate-countdown: 0x05 -> 0x04");
});

// -- 2. ABORT (grounded on the spawnEnemyIntoFreeSlotCyclingAnim oracle) ------------------------------

test("ABORT: module == spawnEnemyIntoFreeSlotCyclingAnim-oracle reference — first empty record spawns, sweep aborts", () => {
  const ref = craftAbortReference();
  const c = craftSpawnAbort();
  spawnEnemyOnBlinkCountdownSweep(c);

  const d = ramDiffMinusStack(ref, c);
  assert.equal(d, null, d && `RAM diff at ${hx(d.addr ?? 0)}: ref=${d.a} module=${d.b}`);
  assert.equal(c.mem.read8(rec(0) + 1), 0x01, "record 0 stayed active (skipped, not respawned)");
  assert.equal(c.mem.read8(rec(1) + 1), 0x01, "record 1 spawned (activated)");
  assert.equal(c.mem.read8(rec(1) + 4), 0x15, "record 1 seeded");
  assert.equal(c.mem.read8(rec(2) + 1), 0x00, "record 2 untouched -> sweep aborted after the spawn");
  console.log("  ABORT: record 1 spawned, record 2 preserved (skip unwound the sweep)");
});

// -- 3. ORACLE-DEFECT tripwire ----------------------------------------------

test("FIXED: the guard-fixed caller oracle aborts after one spawn (matches the module)", () => {
  // translated/loc_6a0f.js now carries `if (m.pc !== 0x6a2f) return;` (like loc_6404), so it unwinds on
  // the spawn's pop-af/ret and aborts the sweep — the MAME-confirmed one-spawn fix. The abort case that
  // used to diverge (raw oracle over-spawned) is now RAM-equivalent between oracle and module.
  const o = craftSpawnAbort();
  const c = craftSpawnAbort();
  oracle(o);
  spawnEnemyOnBlinkCountdownSweep(c);
  assert.equal(o.mem.read8(rec(2) + 1), 0x00, "guard-fixed oracle left record 2 untouched (aborted after one spawn)");
  assert.equal(c.mem.read8(rec(2) + 1), 0x00, "module correctly left record 2 untouched");
  console.log("  FIXED: guard-fixed oracle == module — one spawn, sweep aborted");
});

// -- 4. TEETH ----------------------------------------------------------------

test("TEETH: a stray write past the abort (a no-abort bug) is caught by the reference diff", () => {
  const ref = craftAbortReference();
  const c = craftSpawnAbort();
  spawnEnemyOnBlinkCountdownSweep(c);
  c.mem.write8(rec(2) + 1, 0x01); // simulate a driver that failed to abort and spawned record 2

  const d = ramDiffMinusStack(ref, c);
  assert.notEqual(d, null, "gate FAILED to catch a stray post-abort write — worthless");
  assert.equal(d.addr, rec(2) + 1, `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(rec(2) + 1)})`);
  console.log(`  TEETH/RAM: stray post-abort write caught at ${hx(d.addr)} (ref=${d.a} broken=${d.b})`);
});
