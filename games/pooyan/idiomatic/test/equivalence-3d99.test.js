// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armEnemyTurnAnimation (ROM 0x3d99, Pooyan) — enter the turn/select animation
 * state. It picks one of three sequences from the select table by the record's low-2-bit field
 * minus one, installs it on the record, arms the record's velocity and state bytes, and enqueues
 * the accompanying sound command.
 *
 * SEATING: TAIL-CALL — the oracle's own body has no ret; it `jp`s into the sound-enqueue routine,
 * so its effective seating is that delegatee's (a plain balanced ret). WIRE. The module returns
 * the delegatee's result directly (void). Entry register IX is the record pointer, seated as the
 * param-default bridge. armEnemyTurnAnimation is void — no register the caller reads — so equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP; SP is parked in STACK_SCRATCH so the nested pushes drop out.
 *
 * The state is CRAFTED at a spare record; a boot does not seat this state entry.
 *
 * Jobs:
 *   1. EQUAL — select fields 1, 2, 3 each choose a different table word: oracle == module in RAM.
 *   2. WRITE-SET — the record's state byte, velocity byte, and animation frame index are armed.
 *   3. TEETH — a wrong installed-pointer byte is caught by the RAM diff; two different select
 *      fields install different pointers, proving the select drives the table lookup.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3d99.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3d99 as oracle } from "../../translated/loc_3d99.js";
import { armEnemyTurnAnimation } from "../armEnemyTurnAnimation.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0; //  a spare object record base
const SELECT = 0x07; // record: low 2 bits pick the animation
const STATE = 0x02; //  record: state byte armed to 0x0f
const VEL = 0x09; //     record: velocity byte armed to 0x40
const ANIM_LO = 0x0c; // record: installed sequence pointer low
const ANIM_HI = 0x0d; // record: installed sequence pointer high
const FRAME = 0x0e; //   record: animation frame index reset to 0
const SP0 = 0x8ff0; //   inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the record's select field; pre-dirty the fields the routine writes so writes are visible. */
function seat(m, { select = 0x01 } = {}) {
  m.regs.sp = SP0;
  m.regs.ix = REC;
  for (const off of [STATE, VEL, ANIM_LO, ANIM_HI, FRAME]) m.mem.write8(REC + off, 0xee);
  m.mem.write8(REC + SELECT, select);
  return m;
}

const craft = (select) => seat(BASE.clone(), { select });

const CASES = [1, 2, 3];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: armEnemyTurnAnimation == oracle in RAM (−stack)", () => {
  for (const select of CASES) {
    const o = craft(select);
    const c = craft(select);
    oracle(o);
    armEnemyTurnAnimation(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `select ${select}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} select values identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the record's state, velocity, and frame index are armed", () => {
  const m = craft(0x01);
  oracle(m);
  assert.equal(m.mem.read8(REC + STATE), 0x0f, "state byte armed to 0x0f");
  assert.equal(m.mem.read8(REC + VEL), 0x40, "velocity byte armed to 0x40");
  assert.equal(m.mem.read8(REC + FRAME), 0x00, "animation frame index reset to 0");
  console.log("  WRITE-SET: state=0x0f, velocity=0x40, frame=0");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong installed-pointer byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x02);
  const c = craft(0x02);
  oracle(o);
  armEnemyTurnAnimation(c);
  c.mem.write8(REC + ANIM_LO, (o.mem.read8(REC + ANIM_LO) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted pointer byte");
  assert.equal(d.addr, REC + ANIM_LO, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: different select fields install different sequence pointers", () => {
  const a = craft(0x01);
  const b = craft(0x03);
  oracle(a);
  oracle(b);
  // The two crafts differ in the SELECT input byte itself (rec+0x07), which a whole-RAM diff would
  // report before the pointer bytes; read the INSTALLED pointer directly to prove the select drives
  // the table lookup.
  const ptrA = (a.mem.read8(REC + ANIM_HI) << 8) | a.mem.read8(REC + ANIM_LO);
  const ptrB = (b.mem.read8(REC + ANIM_HI) << 8) | b.mem.read8(REC + ANIM_LO);
  assert.notEqual(
    ptrA,
    ptrB,
    `the select must drive the table lookup — selects 1 and 3 installed the same pointer ${hx(ptrA)}`,
  );
  console.log(`  TEETH(select): select 1 -> ${hx(ptrA)}, select 3 -> ${hx(ptrB)}`);
});
