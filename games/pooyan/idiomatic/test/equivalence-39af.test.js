// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceEnemyActorMotion (ROM 0x39af, Pooyan) — enemy actor state handler (rst-0x28
 * dispatch target) for the record at IX.
 *
 * SEATING: BALANCED — record base in IX (param default m.regs.ix). advanceEnemyActorMotion is a void state handler:
 * the dispatcher reads no register back, so LIVE-OUT is memory only and the comparison is RAM
 * (dumpState) minus stack scratch below the entry SP; the register file is not compared. SP parked in STACK_SCRATCH so
 * nested pushes drop out. Not a dispatcher (no rst/tail m.call), no register bridge.
 *
 * The animation step (+0x0e held nonzero -> a plain decrement) is kept deterministic. Both top
 * branches are crafted: even frame -> the travel handler (advanceTravelingEnemyToArrival); odd frame -> the vertical mover
 * (advanceEnemyVerticalAndDispatchByAltitude) and its sub-branches (arm at high<2, sub-state reset at high<4, inert, keep-travelling).
 * The keep-travel arms route through fireEnemyShotWhenAlignedWithPlayer's shared tail, gated inert by the global lane countdown.
 *
 * NOTE (cross-group seam): the odd/state0 case flows advanceEnemyActorMotion -> advanceEnemyVerticalAndDispatchByAltitude -> armActorDropAnimationNearTop. advanceEnemyVerticalAndDispatchByAltitude
 * (group g3) and armActorDropAnimationNearTop (group g4) are decompiled concurrently; if their arg ABI is not reconciled
 * this case surfaces it. That is intended coverage, not a defect in advanceEnemyActorMotion.
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — an odd/keep-travel record ticks +3 by velocity; the anim hold decrements.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips the branch diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-39af.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_39af as oracle } from "../../translated/loc_39af.js";
import { advanceEnemyActorMotion } from "../advanceEnemyActorMotion.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; // actor record base seated in IX
const REC_LEN = 0x18;
const SP0 = 0x8ff0; // inside STACK_SCRATCH
const ROUND_COUNTER = 0x8907;
const GAUGE_PHASE = 0x8908;
const WAVE_PROGRESS = 0x8d7d;
const LANE_SPAWN = 0x8d75;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + registers + globals the flow reads. Pre-dirty the record so writes are observable. */
function seat(m, { fields = {}, round = 0, gauge = 0x08, wave = 0x0e, lane = 0x01 } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.ix = REC;
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0x55);
  m.mem.write8(REC + 0x0e, 0x05); // anim hold nonzero -> the player just decrements it
  m.mem.write8(REC + 0x0a, 0x00); // velocity 0 -> the mover leaves the position bytes fixed
  for (const [off, v] of Object.entries(fields)) m.mem.write8(REC + Number(off), v);
  m.mem.write8(ROUND_COUNTER, round);
  m.mem.write8(GAUGE_PHASE, gauge);
  m.mem.write8(WAVE_PROGRESS, wave); // >= 0x0e routes fireEnemyShotWhenAlignedWithPlayer into its tail
  m.mem.write8(LANE_SPAWN, lane); // nonzero -> the shared tail returns inert
  return m;
}

const CASES = {
  "even -> travel, state0, no land": (m) => seat(m, { round: 0, fields: { 0x08: 0x00, 0x07: 0x00, 0x03: 0x00, 0x04: 0x10 } }),
  "even -> travel, state0, land": (m) => seat(m, { round: 0, fields: { 0x08: 0x00, 0x07: 0x00, 0x03: 0x00, 0x04: 0x1b } }),
  "even -> travel, statenz, keep travel": (m) => seat(m, { round: 0, fields: { 0x08: 0x00, 0x07: 0x01, 0x03: 0x00, 0x04: 0x10 } }),
  "even -> travel, statenz, retire": (m) => seat(m, { round: 0, fields: { 0x08: 0x00, 0x07: 0x01, 0x03: 0x00, 0x04: 0x1d } }),
  "odd -> mover, state0 (3a51 seam)": (m) => seat(m, { round: 1, fields: { 0x07: 0x00, 0x04: 0x01 } }),
  "odd -> mover, statenz, sub-reset": (m) => seat(m, { round: 1, fields: { 0x07: 0x01, 0x04: 0x03 } }),
  "odd -> mover, statenz, inert": (m) => seat(m, { round: 1, fields: { 0x07: 0x01, 0x04: 0x08 } }),
  "odd -> mover, statenz, keep travel": (m) => seat(m, { round: 1, fields: { 0x07: 0x01, 0x04: 0x20 } }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceEnemyActorMotion == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceEnemyActorMotion(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: an odd/keep-travel record ticks +3 by velocity; the anim hold decrements", () => {
  const c = seat(BASE.clone(), { round: 1, fields: { 0x07: 0x01, 0x04: 0x20, 0x03: 0x40, 0x0a: 0x03 } });
  advanceEnemyActorMotion(c);
  assert.equal(c.mem.read8(REC + 0x03), 0x43, "0x40 + velocity 3 -> 0x43 at +3");
  assert.equal(c.mem.read8(REC + 0x0e), 0x04, "anim hold 0x05 -> 0x04");
  console.log("  WRITE-SET: +3 advanced by velocity; anim hold decremented");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const craft = CASES["even -> travel, statenz, retire"];
  const o = craft(BASE.clone());
  const c = craft(BASE.clone());
  oracle(o);
  advanceEnemyActorMotion(c);
  c.mem.write8(REC + 0x02, (o.mem.read8(REC + 0x02) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC + 0x02, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the retire diverges from the oracle", () => {
  const craft = CASES["even -> travel, statenz, retire"];
  const o = craft(BASE.clone());
  const c = craft(BASE.clone()); // twin: never run the handler -> pre-dirty survives
  oracle(o);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped retire must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
