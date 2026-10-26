// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for loc_5733 (ROM 0x5733, Pooyan) — the spawn body that initialises one
 * actor slot and enters the start-of-scan state machine.
 *
 * A fresh clone per side, the oracle on one and loc_5733 on the other, compared on RAM (dumpState)
 * minus stack scratch below the entry SP. pc/SP/cycles are NOT compared; the routine is a caller-skip spawn with no
 * register live-out (its whole output is the initialised record, the spawn timer, the enemy tally,
 * and whatever the start-of-scan machine writes). Both sides drive the same start-of-scan stepper
 * (frozen for the oracle, the idiomatic siblings for the module), so its writes cancel in the diff
 * and the test isolates loc_5733's own wiring: the clamped/round-shifted column, the two round-parity
 * table lookups, the animation arm, and the tally bump.
 *
 * INPUTS: C (entry seed -> the state dispatch; != 1 keeps it on the sub-state stepper, not the spawn
 * path), IX (the actor slot), E (a field byte). World cells seated: the round counter, the difficulty
 * DSW, the gauge phase, and the column bias select the column branches; the sub-state counter/block
 * hold the stepper on its plain decrement-and-return arm.
 *
 * Jobs:
 *   1. EQUAL — even/odd round, clamped difficulty, gauge bias on/off, and a capped column: oracle ==
 *      loc_5733 in RAM (−stack).
 *   2. WRITE-SET — a spawn bumps the active-enemy tally by one.
 *   3. TEETH — a wrong spawn-timer byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5733.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5733 as oracle } from "../../translated/loc_5733.js";
import { loc_5733 } from "../loc_5733.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ENEMY_SPAWN_TIMER, ACTIVE_ENEMY_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX = 0x8ae0; //  actor slot
const ROUND = 0x8907; //  round counter (bit0 = parity; full byte shifts the column)
const DIFF = 0x8820; //  difficulty DSW
const GAUGE = 0x8908; //  gauge phase counter
const BIAS = 0x8d4c; //  column bias cell
const CNT = 0x8d46; //  sub-state counter (1..6 -> plain stepper arm)
const BLK = 0x8d47; //  first sub-state byte
const SP0 = 0x8ff0; //  inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with the spawn interface + column-branch world seated. */
function craft(spec = {}) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = IX;
  m.regs.c = (spec.seed ?? 0xff) & 0xff; // entry seed -> state dispatch (!= 1: sub-state stepper)
  m.regs.e = (spec.e ?? 0x40) & 0xff;
  m.mem8[ROUND] = (spec.round ?? 0x02) & 0xff;
  m.mem8[DIFF] = (spec.diff ?? 0x01) & 0xff;
  m.mem8[GAUGE] = (spec.gauge ?? 0x00) & 0xff;
  m.mem8[BIAS] = (spec.bias ?? 0x00) & 0xff;
  m.mem8[CNT] = 0x03; // 1..6 -> plain decrement-and-return stepper arm
  m.mem8[BLK] = 0x02; // first sub-state byte nonzero
  return m;
}

const CASES = [
  { name: "even round, low difficulty, no gauge bias", spec: { round: 0x02, diff: 0x01, gauge: 0x00 } },
  { name: "even round, clamped difficulty + gauge bias", spec: { round: 0x02, diff: 0x05, gauge: 0x08, bias: 0x04 } },
  { name: "odd round, mid difficulty, no bias", spec: { round: 0x03, diff: 0x02, gauge: 0x00 } },
  { name: "odd round, clamped + bias -> capped column", spec: { round: 0x03, diff: 0x07, gauge: 0x06, bias: 0x30 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted spawn cases — loc_5733 == oracle in RAM (−stack)", () => {
  for (const { name, spec } of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    loc_5733(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted spawn cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a spawn bumps the active-enemy tally by one", () => {
  const m = craft(CASES[0].spec);
  const before = m.mem8[ACTIVE_ENEMY_COUNT];
  oracle(m);
  assert.equal(m.mem8[ACTIVE_ENEMY_COUNT], (before + 1) & 0xff, "active-enemy tally incremented");
  console.log(`  WRITE-SET: tally ${before} -> ${m.mem8[ACTIVE_ENEMY_COUNT]}`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong spawn-timer byte is CAUGHT by the RAM diff", () => {
  const o = craft(CASES[0].spec);
  const c = craft(CASES[0].spec);
  oracle(o);
  loc_5733(c);
  c.mem8[ENEMY_SPAWN_TIMER] = (c.mem8[ENEMY_SPAWN_TIMER] ^ 0xff) & 0xff; // BUG: wrong spawn timer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong spawn-timer byte — it is worthless");
  assert.equal(d.addr, ENEMY_SPAWN_TIMER, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong spawn timer caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
