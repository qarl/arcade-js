// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for spawnNextEnemyOnDelay — the projectile/arrow spawner driver, the CALLER that
 * dissolves launchWolfIntoSlot's per-record launch caller-skip.
 *
 * While the shared frame-delay timer runs, spawnNextEnemyOnDelay ticks it and returns; once it reads zero, and
 * unless all eight waves have spawned, it walks eight paired records (IX over 0x8ae0, IY over 0x8b70,
 * stride 0x18) launching each through launchWolfIntoSlot. In the frozen oracle a launch's `pop af; ret` unwinds
 * to spawnNextEnemyOnDelay's caller, aborting the walk; the idiomatic driver reproduces that with
 * `if (!launchWolfIntoSlot(...)) return`. This gate COMPOSES the real idiomatic launchWolfIntoSlot (imported by the module)
 * and checks oracle == module in RAM (dumpState, minus stack scratch below the entry SP). spawnNextEnemyOnDelay has no register
 * live-out (loop bookkeeping only), so only RAM is compared; SP sits in dead stack so the oracle's
 * caller-skip frames drop out of the diff.
 *
 * The launch cases seat wave 0 (0x892d=0), so launchWolfIntoSlot takes its light path (no IY-record block).
 *
 * Jobs:
 *   1. EQUAL — delay-tick, all-waves-done, all-occupied-full-walk, and launch-abort: oracle == module.
 *   2. ABORT — a launch on record 0 leaves record 1 untouched and bumps the wave number exactly once.
 *   3. TEETH — a would-be second launch (a non-aborting walk) is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-756d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_756d as oracle } from "../../translated/loc_756d.js";
import { spawnNextEnemyOnDelay } from "../spawnNextEnemyOnDelay.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DELAY = 0x8929; //  SHARED_FRAME_DELAY_TIMER
const WAVE = 0x892d; //   WAVE_NUMBER
const STRIDE = 0x18;
const SP0 = 0x8ff0; //    inside STACK_SCRATCH; the oracle's caller-skip pops land here
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const ix = (k) => (ENEMY_ACTOR_TABLE + k * STRIDE) & 0xffff;
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: SP in dead stack (zeroed), delay elapsed, wave 0, all eight records occupied. */
function craft() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let a = STACK_SCRATCH.lo; a < STACK_SCRATCH.hi; a++) m.mem.write8(a, 0x00);
  m.mem.write8(DELAY, 0x00); // delay elapsed -> proceed to the walk
  m.mem.write8(WAVE, 0x00); // wave 0 -> launchWolfIntoSlot light path
  for (let k = 0; k < 8; k++) m.mem.write8(ix(k), 0x01); // occupied -> launchWolfIntoSlot returns true (no launch)
  return m;
}

/** Free record k so launchWolfIntoSlot launches it (slot low bit clear). */
function free(m, k) {
  m.mem.write8(ix(k) + 0x00, 0x00);
  m.mem.write8(ix(k) + 0x01, 0x00);
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: delay-tick, waves-done, full-walk, launch-abort — module == oracle in RAM (−stack)", () => {
  const states = [
    ["delay still running", (m) => m.mem.write8(DELAY, 0x03)],
    ["all eight waves spawned", (m) => { m.mem.write8(DELAY, 0x00); m.mem.write8(WAVE, 0x08); }],
    ["all records occupied -> full walk", () => {}],
    ["launch on record 0 -> abort", (m) => free(m, 0)],
  ];
  for (const [label, seat] of states) {
    const o = craft(); seat(o);
    const c = craft(); seat(c);
    oracle(o);
    spawnNextEnemyOnDelay(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: 4 arms identical (RAM −stack), composed idiomatic launchWolfIntoSlot");
});

// -- 2. ABORT -----------------------------------------------------------------

test("ABORT: a launch on record 0 aborts the walk — record 1 untouched, wave bumped once", () => {
  const o = craft(); free(o, 0); free(o, 1); // both would launch; only record 0 should
  const c = craft(); free(c, 0); free(c, 1);
  oracle(o);
  spawnNextEnemyOnDelay(c);

  assert.equal(o.mem.read8(ix(0)), 0x01, "oracle: record 0 launched (marked active)");
  assert.equal(o.mem.read8(ix(1)), 0x00, "oracle: record 1 untouched -> the walk aborted");
  assert.equal(o.mem.read8(WAVE), 0x01, "oracle: wave number bumped exactly once");
  assert.equal(c.mem.read8(ix(1)), 0x00, "module: record 1 untouched -> early-return aborted the walk");
  assert.equal(c.mem.read8(WAVE), 0x01, "module: wave number bumped exactly once");
  console.log("  ABORT: record 0 launched, record 1 preserved, wave bumped once");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a would-be second launch (a non-aborting walk) is caught by the RAM diff", () => {
  const o = craft(); free(o, 0); free(o, 1);
  const c = craft(); free(c, 0); free(c, 1);
  oracle(o);
  spawnNextEnemyOnDelay(c);
  assert.equal(c.mem.read8(ix(1)), 0x00, "sanity: the aborting walk left record 1 free");
  c.mem.write8(ix(1), 0x01); // BUG: a non-aborting walk would launch record 1 too
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a stray second launch — it is worthless");
  assert.equal(d.addr, ix(1), `teeth caught the wrong address ${hx(d.addr ?? 0)} (expected ${hx(ix(1))})`);
  console.log(`  TEETH/RAM: stray second launch caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
