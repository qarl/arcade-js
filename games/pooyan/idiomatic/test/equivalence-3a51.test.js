// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armActorDropAnimationNearTop (ROM 0x3a51, Pooyan) — arm the drop animation near the top.
 *
 * SEATING: BALANCED — the high-position byte arrives in B (param default m.regs.b) and the actor
 * record base in IX (param default m.regs.ix). Above the arm window it returns inert; below it
 * marshals the animation pointer (DE) and the record base (IX) into the frozen loc_381e, then stamps
 * the drop sub-state and reloads the phase timer. LIVE-OUT is memory only (record fields at IX). SP
 * parked in STACK_SCRATCH. IX is a register bridge into the frozen callee, so a poison-bridge arm
 * proves the re-seat.
 *
 * Jobs:
 *   1. EQUAL — both arms (armed / inert): oracle == module in RAM (−stack).
 *   2. WRITE-SET — armed stamps +0x0c..0x0e/+0x02/+0x11; inert leaves the record untouched.
 *   3. TEETH — a corrupted record byte is caught; a twin that skips the arm diverges.
 *   4. BRIDGE — a poisoned IX is re-seated (bridgeReseatEquivalent).
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3a51.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3a51 as oracle } from "../../translated/loc_39af.js";
import { armActorDropAnimationNearTop } from "../armActorDropAnimationNearTop.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { bridgeReseatEquivalent } from "../../../../core/bridge-reseat.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b00; //  actor record base seated in IX
const SP0 = 0x8ff0; //  inside STACK_SCRATCH
const REC_LEN = 0x18;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record + registers; highPos in B, record base in IX. Pre-dirty so a stamp is observable. */
function seat(m, highPos) {
  m.regs.sp = SP0;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.b = highPos;
  m.regs.ix = REC;
  for (let i = 0; i < REC_LEN; i++) m.mem.write8(REC + i, 0x55);
  return m;
}

const CASES = {
  "armed (highPos < 2)": 0x01,
  "inert (highPos >= 2)": 0x02,
};

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: armActorDropAnimationNearTop == oracle in RAM (−stack)", () => {
  for (const [name, highPos] of Object.entries(CASES)) {
    const o = seat(BASE.clone(), highPos);
    const c = seat(BASE.clone(), highPos);
    oracle(o);
    armActorDropAnimationNearTop(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${Object.keys(CASES).length} arms identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: armed stamps the record; inert leaves it untouched", () => {
  const armed = seat(BASE.clone(), 0x01);
  armActorDropAnimationNearTop(armed);
  assert.equal(armed.mem.read8(REC + 0x0c), 0xd1, "anim pointer low = 0xd1");
  assert.equal(armed.mem.read8(REC + 0x0d), 0x3b, "anim pointer high = 0x3b");
  assert.equal(armed.mem.read8(REC + 0x0e), 0x00, "anim phase cleared");
  assert.equal(armed.mem.read8(REC + 0x02), 0x02, "drop sub-state");
  assert.equal(armed.mem.read8(REC + 0x11), 0x28, "phase timer reload");

  const inert = seat(BASE.clone(), 0x02);
  const before = inert.dumpState();
  oracle(inert);
  assert.deepEqual([...inert.dumpState()], [...before], "an inert arm must leave RAM untouched");
  console.log("  WRITE-SET: armed stamp complete; inert untouched");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted record byte is CAUGHT by the RAM diff", () => {
  const o = seat(BASE.clone(), 0x01);
  const c = seat(BASE.clone(), 0x01);
  oracle(o);
  armActorDropAnimationNearTop(c);
  c.mem.write8(REC + 0x11, (o.mem.read8(REC + 0x11) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted byte");
  assert.equal(d.addr, REC + 0x11, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a twin that skips the arm diverges from the oracle", () => {
  const o = seat(BASE.clone(), 0x01);
  const t = seat(BASE.clone(), 0x01); // twin: do nothing -> pre-dirty 0x55 filler survives
  oracle(o);
  const d = ramDiffMinusStack(o, t);
  assert.notEqual(d, null, "a skipped arm must be caught by the RAM diff");
  console.log(`  TEETH(twin): caught at ${hx(d.addr ?? 0)}`);
});

// -- 4. BRIDGE ----------------------------------------------------------------

test("BRIDGE: a poisoned IX is re-seated before the frozen loc_381e", () => {
  const entry = seat(BASE.clone(), 0x01);
  const { equal, ram } = bridgeReseatEquivalent(entry, oracle, armActorDropAnimationNearTop, {
    live: { ix: REC },
    poison: { ix: 0x8b40 }, // wrong record base; a missing re-seat writes the anim pointer there
    args: [0x01, REC],
    excludeAddr: inDeadStack,
  });
  assert.equal(equal, true, ram && `bridge diverged at ${hx(ram.addr ?? 0)}: oracle=${ram.a} module=${ram.b}`);
  console.log("  BRIDGE: IX re-seated (RAM-equal under poison)");
});
