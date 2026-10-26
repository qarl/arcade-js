// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armEnemyState8Animation (ROM 0x3d18, Pooyan) — the object state-8 handler: pick a
 * frame-timer reseed and an animation index from the difficulty byte / child index / direction bit,
 * install the animation, advance the state, and fall through into the frozen state-9 handler
 * advanceEnemyAnimationPhase.
 *
 * The module dissolves 0038/0c45/381e and the advanceEnemyAnimationPhase fall-through to direct idiomatic calls (the
 * record passed as a param); the oracle drives all four through the routines
 * map. armEnemyState8Animation is a void handler — it delegates its return to the state-9 chain, no register
 * survives to a caller — so the register file is not compared; equivalence is RAM (dumpState) minus
 * stack scratch below the entry SP, SP parked in dead stack so the nested pushes drop out of the diff.
 *
 * Two crafted records exercise both control paths: the difficulty-active path (queues a display
 * command, reseeds the timer to 0x38) and the idle path (difficulty 0, reseed 0x20). Both seat the
 * record's frame timer so the frozen state-9 handler decrements it and returns at once — an isolated
 * footprint.
 *
 * Jobs:
 *   1. EQUAL — active + idle records: oracle == armEnemyState8Animation in RAM (−stack).
 *   2. WRITE-SET — the handler advances the object state byte (rec+0x02) by one.
 *   3. TEETH — a wrong state byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — the tail dispatch through advanceEnemyAnimationPhase (pops the caller's slot, SP +2) is placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-3d18.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_3d18 as oracle } from "../../translated/loc_3d18.js";
import { armEnemyState8Animation } from "../armEnemyState8Animation.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c30; //   object record base seated in IX (a work-RAM record)
const STATE = REC + 0x02; // object state byte, advanced by the handler
const DIFFICULTY = 0x8d45; // loc_8d45 difficulty byte
const SP0 = 0x8ff0; //   inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // caller-return word seated at SP0; the tail dispatch pops it (pc==this)

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** A fresh clone with one object record on state 2. `active` picks the difficulty-active path. */
function craft(active) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[STATE] = 0x03; //           an arbitrary state, advanced by one
  m.mem8[REC + 0x07] = 0x00; //      direction bit1 clear -> anim index = the C value
  if (active) {
    m.mem8[DIFFICULTY] = 0x02; //    difficulty nonzero -> active path
    m.mem8[REC + 0x12] = 0x05; //    child index != 0xff
  } else {
    m.mem8[DIFFICULTY] = 0x00; //    idle path
    m.mem8[REC + 0x17] = 0x01; //    anim index source
  }
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: active + idle records — armEnemyState8Animation == oracle in RAM (−stack)", () => {
  for (const [label, active] of [["difficulty-active", true], ["idle", false]]) {
    const o = craft(active);
    oracle(o);
    const c = craft(active);
    armEnemyState8Animation(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: active + idle records identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the handler advances the object state byte by one", () => {
  const m = craft(true);
  assert.equal(m.mem8[STATE], 0x03, "precondition: state seeded to 3");
  oracle(m);
  assert.equal(m.mem8[STATE], 0x04, "state advanced 3 -> 4 (frozen state-9 returned before its own bump)");
  console.log("  WRITE-SET: object state 0x03 -> 0x04");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong state byte is CAUGHT by the RAM diff", () => {
  const o = craft(true);
  const c = craft(true);
  oracle(o);
  armEnemyState8Animation(c);
  c.mem8[STATE] = 0x03; // BUG: the handler must have advanced the state
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong state byte — it is worthless");
  assert.equal(d.addr, STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong state byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: the tail dispatch through advanceEnemyAnimationPhase is seam-placeable (SP +2, pc on the caller slot)", () => {
  const entry = craft(true);
  entry.mem.write16(SP0, CALLER_RET); // the caller's return word the tail dispatch consumes
  const r = seamPlaceable(withOmittedRet, armEnemyState8Animation, 0x3d18, entry);
  assert.equal(r.placeable, true, `the dispatch must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: armEnemyState8Animation seam-placeable (moved 0, sub-calls direct)");
});
