// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for gateEnemySpawnOnActiveCountAndInit (ROM 0x5871, Pooyan) — the actor-spawn gate. It latches the
 * entry register into the speed index, then launches a new actor only when the active count is
 * strictly below the stage threshold AND below the cap (6). On a launch it raises the spawn-active
 * flag (0x8d4a, proposed SPAWN_ACTIVE_FLAG) and runs the init loop over the record block
 * (idiomatic seedFirstFreeSpriteBlockInRun).
 *
 * SEATING: BALANCED (WIRE). The three early exits are plain `ret`s (net SP 0); the launch path
 * tail-delegates into seedFirstFreeSpriteBlockInRun, which ends in a plain `ret` — no `pop af` anywhere. The module does
 * no stack ops; the oracle's marshalled pushes/pops land in STACK_SCRATCH and drop from the diff.
 *
 * LIVE-OUT: none — a void spawn driver in a void-driver chain (its caller calls it then rets,
 * reading no register back). The register file is not compared. The entry value latched into the
 * speed index is the sole register INPUT (bridged from regs.a). Fidelity = RAM (dumpState) minus
 * stack scratch below the entry SP.
 *
 * DEPENDS ON in-batch sibling seedFirstFreeSpriteBlockInRun (dissolved launch-path call) being written; see reconcile
 * notes (assumed signature seedFirstFreeSpriteBlockInRun(m, base, count)).
 *
 * Jobs:
 *   1. EQUAL — four gate decisions (launch; at-threshold; below-threshold/borrow; roster-full):
 *      oracle == module in RAM (−stack).
 *   2. WRITE-SET — a launch raises the spawn-active flag + latches the speed index; a no-launch
 *      latches the speed index but leaves the flag clear.
 *   3. TEETH — a wrong seeded byte is caught by the RAM diff; and the launch decision is load-bearing
 *      (a launch state sets the flag, an at-threshold state does not).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5871.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5871 as oracle } from "../../translated/loc_5871.js";
import { gateEnemySpawnOnActiveCountAndInit } from "../gateEnemySpawnOnActiveCountAndInit.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPEED_INDEX, STAGE_COUNTDOWN, ACTIVE_ENEMY_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const SPAWN_ACTIVE_FLAG = 0x8d4a; // proposed name (set on launch; gates the spawn/step entry)
const SPEED_SEED = 0x42; // arbitrary entry-register value latched into the speed index
const SP0 = 0x8ff8; // inside STACK_SCRATCH
const CALLER_RET = 0xabcd;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0 - 2); // entry SP: the seat pushes the caller's return word below SP0
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the gate inputs; the flag starts clear so a launch's write to it is observable. */
function craft({ threshold, active }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.push16(CALLER_RET); // the gate's ret / the delegated loop's ret consumes it (dead-stack)
  m.regs.a = SPEED_SEED;
  m.mem.write8(STAGE_COUNTDOWN, threshold);
  m.mem.write8(ACTIVE_ENEMY_COUNT, active);
  m.mem.write8(SPAWN_ACTIVE_FLAG, 0x00);
  m.mem.write8(SPEED_INDEX, 0x00);
  return m;
}

const CASES = [
  { name: "launch (active<threshold, active<cap)", cfg: { threshold: 0x05, active: 0x02 }, launch: true },
  { name: "at-threshold -> no launch", cfg: { threshold: 0x03, active: 0x03 }, launch: false },
  { name: "below-threshold/borrow -> no launch", cfg: { threshold: 0x02, active: 0x04 }, launch: false },
  { name: "roster-full -> no launch", cfg: { threshold: 0x08, active: 0x06 }, launch: false },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: every gate decision — module == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    gateEnemySpawnOnActiveCountAndInit(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} gate decisions identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a launch raises the flag + latches speed; a no-launch latches speed only", () => {
  for (const { name, cfg, launch } of CASES) {
    const m = craft(cfg);
    oracle(m);
    assert.equal(m.mem.read8(SPEED_INDEX), SPEED_SEED, `${name}: speed index always latched`);
    assert.equal(m.mem.read8(SPAWN_ACTIVE_FLAG), launch ? 0x01 : 0x00, `${name}: flag matches launch decision`);
  }
  console.log("  WRITE-SET: speed latched always; flag only on launch");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const cfg = { threshold: 0x05, active: 0x02 }; // launch case
  const o = craft(cfg);
  const c = craft(cfg);
  oracle(o);
  gateEnemySpawnOnActiveCountAndInit(c);
  c.mem.write8(SPEED_INDEX, (o.mem.read8(SPEED_INDEX) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted speed-index byte");
  assert.equal(d.addr, SPEED_INDEX, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: the launch decision is load-bearing (launch sets the flag, at-threshold does not)", () => {
  const launched = craft({ threshold: 0x05, active: 0x02 });
  gateEnemySpawnOnActiveCountAndInit(launched);
  assert.equal(launched.mem.read8(SPAWN_ACTIVE_FLAG), 0x01, "a launch must set the flag");

  const held = craft({ threshold: 0x03, active: 0x03 });
  gateEnemySpawnOnActiveCountAndInit(held);
  assert.equal(held.mem.read8(SPAWN_ACTIVE_FLAG), 0x00, "an at-threshold state must NOT launch");
  console.log("  TEETH(branch): launch/no-launch decision caught by the flag");
});
