// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceTravelingEnemyToArrival (ROM 0x3b87, Pooyan) — horizontal-travel phase of an enemy
 * actor, reached by `jp z,0x3b87` from advanceEnemyActorMotion's mover.
 *
 * SEATING: BALANCED — record base in IX (param default m.regs.ix). A void handler: no caller reads a
 * register back, so LIVE-OUT is memory only and the comparison is RAM (dumpState) minus stack scratch below the entry SP.
 * SP parked in STACK_SCRATCH. Not a dispatcher, no register bridge.
 *
 * Crafted paths: (+8) bit0 set -> the vertical mover (advanceEnemyVerticalAndDispatchByAltitude, kept inert via statenz); (+8) bit0
 * clear with state (+7)==0 -> the land test (blank at +4>=0x1b, else no-op); statenz below 0x1d ->
 * keep travelling (fireEnemyShotWhenAlignedWithPlayer, gated inert); statenz at 0x1d -> retire + queue the retire animation; a
 * carry case where (+3)+velocity overflows and bumps the integer position (+4).
 *
 * Jobs:
 *   1. EQUAL — every crafted path: oracle == module in RAM (−stack).
 *   2. WRITE-SET — a carry advances +4 and stores the wrapped +3.
 *   3. TEETH — a corrupted post-run byte is caught; a twin that skips the retire diverges.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3b87.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3b87 as oracle } from "../../translated/loc_3b87.js";
import { advanceTravelingEnemyToArrival } from "../advanceTravelingEnemyToArrival.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00;
const REC_LEN = 0x18;
const SP0 = 0x8ff0;
const WAVE_PROGRESS = 0x8d7d;
const LANE_SPAWN = 0x8d75;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { fields = {} } = {}) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.ix = REC;
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0x55);
  m.mem.write8(REC + 0x0a, 0x00); // default velocity 0 (overridden per case)
  for (const [off, v] of Object.entries(fields)) m.mem.write8(REC + Number(off), v);
  m.mem.write8(WAVE_PROGRESS, 0x0e); // fireEnemyShotWhenAlignedWithPlayer -> tail
  m.mem.write8(LANE_SPAWN, 0x01); // shared tail returns inert
  return m;
}

const CASES = {
  "bit0 set -> mover (inert)": (m) => seat(m, { fields: { 0x08: 0x01, 0x07: 0x01, 0x04: 0x08 } }),
  "state0 land": (m) => seat(m, { fields: { 0x08: 0x00, 0x07: 0x00, 0x03: 0x00, 0x04: 0x1b } }),
  "state0 no land": (m) => seat(m, { fields: { 0x08: 0x00, 0x07: 0x00, 0x03: 0x00, 0x04: 0x10 } }),
  "statenz keep travel": (m) => seat(m, { fields: { 0x08: 0x00, 0x07: 0x01, 0x03: 0x00, 0x04: 0x10 } }),
  "statenz retire": (m) => seat(m, { fields: { 0x08: 0x00, 0x07: 0x01, 0x03: 0x00, 0x04: 0x1d } }),
  "carry into +4": (m) => seat(m, { fields: { 0x08: 0x00, 0x07: 0x00, 0x03: 0xff, 0x0a: 0x02, 0x04: 0x10 } }),
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceTravelingEnemyToArrival == oracle in RAM (−stack)", () => {
  for (const [name, craft] of Object.entries(CASES)) {
    const o = craft(BASE.clone());
    const c = craft(BASE.clone());
    oracle(o);
    advanceTravelingEnemyToArrival(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} paths identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a carry advances +4 and stores the wrapped +3", () => {
  const c = CASES["carry into +4"](BASE.clone());
  advanceTravelingEnemyToArrival(c);
  assert.equal(c.mem.read8(REC + 0x04), 0x11, "0x10 + carry -> 0x11 at +4");
  assert.equal(c.mem.read8(REC + 0x03), 0x01, "0xff + 2 -> 0x01 at +3");
  console.log("  WRITE-SET: +4 carried; +3 wrapped");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted post-run byte is CAUGHT by the RAM diff", () => {
  const craft = CASES["statenz retire"];
  const o = craft(BASE.clone());
  const c = craft(BASE.clone());
  oracle(o);
  advanceTravelingEnemyToArrival(c);
  c.mem.write8(REC + 0x09, (o.mem.read8(REC + 0x09) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC + 0x09, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the retire diverges from the oracle", () => {
  const craft = CASES["statenz retire"];
  const o = craft(BASE.clone());
  const c = craft(BASE.clone()); // twin: never run -> pre-dirty survives
  oracle(o);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "a skipped retire must be caught by the RAM diff");
  console.log(`  TEETH(skip): caught at ${hx(d.addr ?? 0)}`);
});
