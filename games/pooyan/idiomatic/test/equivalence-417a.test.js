// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armObjectAnimationAndSeedCountdown (ROM 0x417a, Pooyan) — (re)arm an object record, then fall
 * into its countdown tail.
 *
 * A fresh clone per side, the oracle on one and armObjectAnimationAndSeedCountdown on the other, compared on RAM (dumpState,
 * minus stack scratch below the entry SP). armObjectAnimationAndSeedCountdown's live-out is memory only, so the register file is not compared.
 *
 * INPUT: IX (the object record). armObjectAnimationAndSeedCountdown looks up the arm-animation pointer for the arm index
 * (rec+0x17), points the record at it, seats the (rec+0x11) countdown to 0x30, bumps (rec+0x02), then
 * tails into the shared countdown/dwell continuation (which advances the animation and decrements the
 * freshly-seated countdown to 0x2f). The word-lookup helper is a sibling decompiled this same batch
 * (its module resolves at reconcile); the anim-store, anim-step, and countdown tail are verified
 * idiomatic modules. Both sides run the SAME delegatees, so a divergence is armObjectAnimationAndSeedCountdown's own.
 *
 * Cases are CRAFTED (a plain boot does not seat an isolated record); the ROM supplies the arm-anim
 * streams the tail reads.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-417a.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_417a as oracle } from "../../translated/loc_417a.js";
import { armObjectAnimationAndSeedCountdown } from "../armObjectAnimationAndSeedCountdown.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8b80; // isolated object record base (rec..rec+0x17)
const REC_STATE = 0x02;
const REC_COUNTDOWN = 0x11;
const REC_TILE = 0x10; // written by the anim-step from the looked-up sequence
const REC_ARM_INDEX = 0x17;
const hx = (v) => "0x" + (v & 0xffff).toString(16);

const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8fee);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone: IX=REC, zeroed record, SP inside STACK_SCRATCH, arm index + state seated. */
function craft(armIndex, state) {
  const m = BASE.clone();
  m.regs.ix = REC;
  m.regs.sp = 0x8fee; // the two helper calls + the tail's ret stay inside STACK_SCRATCH
  for (let i = 0; i < 0x18; i++) m.mem8[REC + i] = 0x00;
  m.mem8[REC + REC_ARM_INDEX] = armIndex & 0xff;
  m.mem8[REC + REC_STATE] = state & 0xff;
  return m;
}

const CASES = [
  { name: "arm index 0, state 0x05", armIndex: 0x00, state: 0x05 },
  { name: "arm index 3, state 0x00", armIndex: 0x03, state: 0x00 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted records — armObjectAnimationAndSeedCountdown == oracle in RAM (−stack)", () => {
  for (const cse of CASES) {
    const o = craft(cse.armIndex, cse.state);
    const c = craft(cse.armIndex, cse.state);
    oracle(o);
    armObjectAnimationAndSeedCountdown(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${cse.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted records identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: countdown seated then decremented (0x2f); state bumped", () => {
  const m = craft(0x00, 0x05);
  oracle(m);
  assert.equal(m.mem8[REC + REC_COUNTDOWN], 0x2f, "countdown 0x30 seated, tail decremented to 0x2f");
  assert.equal(m.mem8[REC + REC_STATE], 0x06, "state bumped 0x05 -> 0x06");
  console.log("  WRITE-SET: countdown=0x2f, state=0x06");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong countdown byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00, 0x05);
  const c = craft(0x00, 0x05);
  oracle(o);
  armObjectAnimationAndSeedCountdown(c);
  c.mem8[REC + REC_COUNTDOWN] = (c.mem8[REC + REC_COUNTDOWN] + 1) & 0xff; // BUG
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong countdown byte — it is worthless");
  assert.equal(d.addr, REC + REC_COUNTDOWN, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM(countdown): caught at ${hx(d.addr)}`);
});

test("TEETH: a wrong armed tile is CAUGHT (guards the looked-up anim pointer chain)", () => {
  const o = craft(0x03, 0x00);
  const c = craft(0x03, 0x00);
  oracle(o);
  armObjectAnimationAndSeedCountdown(c);
  c.mem8[REC + REC_TILE] = (c.mem8[REC + REC_TILE] + 1) & 0xff; // BUG: wrong tile from the arm sequence
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong armed tile — the lookup chain is untested");
  assert.equal(d.addr, REC + REC_TILE, `teeth caught the wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM(tile): caught at ${hx(d.addr)}`);
});
