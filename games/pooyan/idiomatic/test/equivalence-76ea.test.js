// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runObjectAndEnemyActorUpdate (ROM 0x76ea, Pooyan) — a per-frame driver that runs three
 * subsystems in order: advance the six-record object state table, walk the enemy-actor animation
 * tick, then rebuild the sprite display list. Straight-line, no branches.
 *
 * The module runs two sub-passes as direct idiomatic calls (advanceFirstGroupEnemyActorStates, rebuildSpriteDisplayList) and keeps the
 * object-state-table walk as a machine call (0x76f4 — a spine dispatcher not lifted this batch);
 * the oracle drives all three through the routines map. runObjectAndEnemyActorUpdate is a void sequencer — no register
 * survives, so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP. SP is parked in STACK_SCRATCH so each pass's nested pushes drop out of the diff.
 *
 * Jobs:
 *   1. EQUAL/BOOT — a plain boot clone: oracle == module in RAM (−stack).
 *   2. EQUAL/RICH — six live object-state records: the walk + display rebuild act observably;
 *      oracle == module in RAM (−stack).
 *   3. TEETH — a corrupted result byte is caught by the RAM diff; a twin sequencer that omits the
 *      display-list rebuild diverges from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-76ea.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_76ea as oracle } from "../../translated/loc_76ea.js";
import { runObjectAndEnemyActorUpdate } from "../runObjectAndEnemyActorUpdate.js";
import { advanceFirstGroupEnemyActorStates } from "../advanceFirstGroupEnemyActorStates.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, OBJECT_STATE_RECORD_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const OSR = OBJECT_STATE_RECORD_BASE; // 0x8ba0, object state records (stride 0x18)
const STRIDE = 0x18;
const SP0 = 0x8ff0;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craftBoot() {
  const m = BASE.clone();
  m.regs.sp = SP0;
  return m;
}

function craftRich() {
  const m = craftBoot();
  for (let i = 0; i < 6; i++) m.mem.write8(OSR + i * STRIDE + 0, 0x01); // live object-state records
  return m;
}

/** A twin that runs every pass EXCEPT the display-list rebuild (the structural teeth target). */
function twinNoDisplayRebuild(m) {
  m.call(0x76f4);
  advanceFirstGroupEnemyActorStates(m);
  // (rebuildSpriteDisplayList omitted)
}

// -- 1 & 2. EQUAL -------------------------------------------------------------

test("EQUAL: runObjectAndEnemyActorUpdate == oracle in RAM (−stack), boot and rich", () => {
  for (const [name, craft] of [["boot", craftBoot], ["rich", craftRich]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    runObjectAndEnemyActorUpdate(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: boot + rich identical (RAM −stack)");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted result byte is CAUGHT by the RAM diff", () => {
  const o = craftRich();
  const c = craftRich();
  oracle(o);
  runObjectAndEnemyActorUpdate(c);
  c.mem.write8(OSR + 0, (o.mem.read8(OSR + 0) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted result byte");
  assert.equal(d.addr, OSR + 0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin omitting the display-list rebuild DIVERGES from the oracle", () => {
  const o = craftRich();
  const c = craftRich();
  oracle(o);
  twinNoDisplayRebuild(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "omitting the display-list rebuild must diverge");
  console.log(`  TEETH(order): omission caught at ${hx(d.addr ?? 0)}`);
});
