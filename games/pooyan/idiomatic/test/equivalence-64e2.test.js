// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for runObjectAndSpawnUpdatePass (ROM 0x64e2, Pooyan) — the fountain/spawn subtree driver:
 * seed the two-tile fountain blitter, dispatch the fountain record's per-frame state handler, run
 * the three-record enemy-actor state pass, then the enemy-record state dispatch. Straight-line,
 * no branches.
 *
 * The module runs three sub-passes as direct idiomatic calls (blitStackedTwoTileAnimFrameOnHoldTimer, runActorGroupStateHandler, updateEnemyActorsAndCycleLaunchFlipAnim) and
 * keeps the enemy-record state dispatcher as a machine call (0x6822 — a spine dispatcher not lifted
 * this batch); the oracle drives all four through the routines map. runObjectAndSpawnUpdatePass is a void sequencer —
 * no register survives, so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP. SP is parked in STACK_SCRATCH so each pass's nested pushes (and the module's
 * scratch return frame for the fountain-dispatch tail-return) drop out of the diff.
 *
 * Jobs:
 *   1. EQUAL/BOOT — a plain boot clone: oracle == module in RAM (−stack).
 *   2. EQUAL/RICH — dispatch gate open, three live enemy records, a live lead state: all four
 *      passes act observably; oracle == module in RAM (−stack).
 *   3. TEETH — a corrupted result byte is caught by the RAM diff; a twin sequencer that omits the
 *      enemy-actor state pass diverges from the oracle at the records it would have stepped.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-64e2.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_64e2 as oracle } from "../../translated/loc_64e2.js";
import { runObjectAndSpawnUpdatePass } from "../runObjectAndSpawnUpdatePass.js";
import { blitStackedTwoTileAnimFrameOnHoldTimer } from "../blitStackedTwoTileAnimFrameOnHoldTimer.js";
import { runActorGroupStateHandler } from "../runActorGroupStateHandler.js";
import { updateEnemyActorsAndCycleLaunchFlipAnim } from "../updateEnemyActorsAndCycleLaunchFlipAnim.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_ACTOR_TABLE, HUNTER_TABLE_BASE } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const EAT = ENEMY_ACTOR_TABLE; // 0x8ae0, enemy-actor records (stride 0x18)
const HUNTER = HUNTER_TABLE_BASE; // 0x8c78, fountain record
const GATE = 0x8afa; //   enemy-record dispatch gate (nonzero -> 6822 dispatches)
const DISP = 0x8b28; //   the 0x8ae0+0x48 dispatch record 6822 selects on
const LEAD = 0x8ae2; //   lead state byte 66c5 gates its countdown on
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
  m.mem.write8(GATE, 0x01); // open the enemy-record dispatch
  m.mem.write8(DISP + 2, 0x00); // dispatch state 0
  for (let i = 0; i < 3; i++) {
    m.mem.write8(EAT + i * STRIDE + 0, 0x01); // live enemy record
    m.mem.write8(EAT + i * STRIDE + 2, 0x00); // record state 0
  }
  m.mem.write8(HUNTER + 2, 0x00); // fountain record state 0
  m.mem.write8(LEAD, 0x01); // lead state nonzero -> the countdown steps
  return m;
}

/** A twin that runs every pass EXCEPT the enemy-actor state pass (the structural teeth target). */
function twinNoEnemyPass(m) {
  blitStackedTwoTileAnimFrameOnHoldTimer(m);
  m.regs.ix = HUNTER;
  m.push16(m.pc);
  runActorGroupStateHandler(m);
  // (updateEnemyActorsAndCycleLaunchFlipAnim omitted)
  return m.call(0x6822);
}

// -- 1 & 2. EQUAL -------------------------------------------------------------

test("EQUAL: runObjectAndSpawnUpdatePass == oracle in RAM (−stack), boot and rich", () => {
  for (const [name, craft] of [["boot", craftBoot], ["rich", craftRich]]) {
    const o = craft();
    const c = craft();
    oracle(o);
    runObjectAndSpawnUpdatePass(c);
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
  runObjectAndSpawnUpdatePass(c);
  c.mem.write8(EAT + 0, (o.mem.read8(EAT + 0) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted result byte");
  assert.equal(d.addr, EAT + 0, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin omitting the enemy-actor state pass DIVERGES from the oracle", () => {
  const o = craftRich();
  const c = craftRich();
  oracle(o);
  twinNoEnemyPass(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "omitting the enemy-actor state pass must diverge");
  console.log(`  TEETH(order): omission caught at ${hx(d.addr ?? 0)}`);
});
