// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for runActorUpdatePipeline — the master per-frame actor updater, a pure void sequencer
 * that invokes eleven subsystem handlers in fixed ROM order and returns.
 *
 * The module dissolves all eleven m.call sites to direct idiomatic calls; the oracle drives the same
 * eleven frozen handlers through the routines map. This gate COMPOSES the real idiomatic subtree and
 * checks oracle == module in RAM (dumpState, minus stack scratch below the entry SP). runActorUpdatePipeline has no register live-out
 * (it consumes none of the handlers' results), so only RAM is compared; SP sits in dead stack.
 *
 * Two arms are seated: an idle boot state (every handler gates off — the composition is exercised
 * with a near-empty footprint) and a state seated so the ELEVENTH handler (fireArmedEnemyProjectilesAndDisarm, end-of-wave
 * cleanup) sweeps and clears its two flags — a positive control that the last call in the sequence
 * actually runs (a dropped or reordered eleventh call would leave those flags set).
 *
 * Jobs:
 *   1. EQUAL — idle + eleventh-handler-active: oracle == module in RAM (−stack).
 *   2. COMPOSITION — the seated eleventh handler clears LANE_SPAWN_COUNTDOWN / LAUNCH_ARM_LATCH
 *      (1 -> 0), proving the last call in the sequence executed, and the module matches.
 *   3. TEETH — a wrong cleared flag is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5ae4.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5ae4 as oracle } from "../../translated/loc_5ae4.js";
import { runActorUpdatePipeline } from "../runActorUpdatePipeline.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const LANE_SPAWN_COUNTDOWN = 0x8d75; // fireArmedEnemyProjectilesAndDisarm gate; cleared to 0 on its sweep
const CLEANUP_GATE_8D77 = 0x8d77; //   set -> fireArmedEnemyProjectilesAndDisarm takes the sweep path directly
const ACTIVE_LANE_COUNT = 0x8d79; //   fireArmedEnemyProjectilesAndDisarm returns early when nonzero
const LAUNCH_ARM_LATCH = 0x8f20; //    cleared to 0 alongside LANE_SPAWN_COUNTDOWN on the sweep
const SP0 = 0x8ff8; //                 inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function base() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let a = STACK_SCRATCH.lo; a < STACK_SCRATCH.hi; a++) m.mem.write8(a, 0x00);
  return m;
}

/** Idle boot state: every subsystem handler gates off. */
function craftIdle() {
  return base();
}

/** Seat the eleventh handler (fireArmedEnemyProjectilesAndDisarm) onto its sweep-and-clear path. */
function craftEleventh() {
  const m = base();
  m.mem.write8(LANE_SPAWN_COUNTDOWN, 0x01); // nonzero -> fireArmedEnemyProjectilesAndDisarm proceeds
  m.mem.write8(ACTIVE_LANE_COUNT, 0x00); // zero -> fireArmedEnemyProjectilesAndDisarm proceeds
  m.mem.write8(CLEANUP_GATE_8D77, 0x01); // set -> straight to the sweep
  m.mem.write8(LAUNCH_ARM_LATCH, 0x01); // will be cleared by the sweep
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: idle + eleventh-handler-active — module == oracle in RAM (−stack)", () => {
  for (const [label, craft] of [["idle", craftIdle], ["eleventh handler active", craftEleventh]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    runActorUpdatePipeline(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: idle + eleventh-active identical (RAM −stack), composed idiomatic subtree");
});

// -- 2. COMPOSITION -----------------------------------------------------------

test("COMPOSITION: the eleventh handler runs — its two flags are cleared 1 -> 0", () => {
  const o = craftEleventh();
  assert.equal(o.mem.read8(LANE_SPAWN_COUNTDOWN), 0x01, "pre: countdown seated to 1");
  assert.equal(o.mem.read8(LAUNCH_ARM_LATCH), 0x01, "pre: launch latch seated to 1");
  oracle(o);
  assert.equal(o.mem.read8(LANE_SPAWN_COUNTDOWN), 0x00, "oracle: eleventh handler cleared the countdown");
  assert.equal(o.mem.read8(LAUNCH_ARM_LATCH), 0x00, "oracle: eleventh handler cleared the launch latch");

  const c = craftEleventh();
  runActorUpdatePipeline(c);
  assert.equal(c.mem.read8(LANE_SPAWN_COUNTDOWN), 0x00, "module: eleventh handler cleared the countdown");
  assert.equal(c.mem.read8(LAUNCH_ARM_LATCH), 0x00, "module: eleventh handler cleared the launch latch");
  console.log("  COMPOSITION: the eleventh handler executed (both flags cleared)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong cleared flag is caught by the RAM diff", () => {
  const o = craftEleventh();
  const c = craftEleventh();
  oracle(o);
  runActorUpdatePipeline(c);
  c.mem.write8(LANE_SPAWN_COUNTDOWN, 0x01); // BUG: the sweep must have cleared it to 0
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong cleared flag — it is worthless");
  assert.equal(d.addr, LANE_SPAWN_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong cleared flag caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
