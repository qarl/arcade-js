// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for armObjectFromSpawnRing (ROM 0x771d, Pooyan) — object-state 0: arm a new object.
 *
 * A per-object state handler dispatched by jp (hl) from loc_7707; it reads its record from IX and
 * writes only record + spawn-ring RAM, so the contract is memory (dumpState minus stack scratch below the entry SP) with
 * NO register live-out. fetchByteFromTableIndex (the table fetch) is dissolved; the fall-through into state 1
 * (moveObject) is a direct tail call.
 *
 * SP-TOOTH (R36): the module is a wired override reached through the seam, so it must seat SP
 * correctly. Both the full path and the early path leave SP at the seat (moved 0) and must be
 * seam-placeable. The null-mutant proof lives once-per-game in sp-seam-tooth.test.js.
 *
 * The record is crafted so the fall-through mover returns shallow ((REC+4)&0x1f>=9, (REC+0x0e) high so
 * the 0x4006 refresh just decrements), keeping the run bounded.
 *
 * Jobs:
 *   1. EQUAL — early path ((REC+0x11) still counting -> return) and full path (expiry -> arm the
 *      object + fall into 0x7740): oracle == armObjectFromSpawnRing in RAM (−stack).
 *   2. WRITE-SET — the full path stores the spawn index, seeds the speed, advances the state, and
 *      steps the spawn ring; the early path only ticks the countdown.
 *   3. TEETH — a wrong armed byte is CAUGHT by the RAM diff.
 *   4. SP-TOOTH — full (tail-dispatch, +2) and early (omitted ret, 0) are both seam-placeable.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-771d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_771d as oracle } from "../../translated/loc_771d.js";
import { armObjectFromSpawnRing } from "../armObjectFromSpawnRing.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, SPAWN_RING_COUNTER } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8ba0; //   an object-arena record base (work RAM)
const FRAME = 0x11; //    (REC+0x11) frame countdown: 1 -> expiry -> full path; >1 -> early return
const STATE = 0x02; //    (REC+2) state byte, advanced on the full path
const SPEED = 0x0a; //    (REC+0x0a) seeded to 0xec on the full path
const SPIDX = 0x13; //    (REC+0x13) := spawn index on the full path
const SP0 = 0x8ff0; //    inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // sentinel caller-return word the tail-dispatch / seam consumes
const RING_SEED = 0x03; // SPAWN_RING_COUNTER seed -> spawn index 3, ring steps to 4

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** frame: (REC+0x11) seed. 1 -> full path (expiry); >1 -> early return. */
function craft(frame) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(SP0, CALLER_RET);
  m.regs.ix = REC;
  m.mem8[REC + FRAME] = frame & 0xff;
  m.mem8[REC + STATE] = 0x00; // state 0
  m.mem8[REC + 0x04] = 0x10; // (REC+4)&0x1f = 0x10 >= 9 -> mover returns shallow
  m.mem8[REC + 0x03] = 0x40; // position >= neg(speed) -> no borrow in the mover
  m.mem8[REC + 0x0e] = 0x40; // 0x4006 refresh decrements-and-returns
  m.mem8[SPAWN_RING_COUNTER] = RING_SEED;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: early + full path — armObjectFromSpawnRing == oracle in RAM (−stack)", () => {
  for (const [label, frame] of [["full (expiry)", 0x01], ["early (counting)", 0x05]]) {
    const o = craft(frame);
    oracle(o);
    const c = craft(frame);
    armObjectFromSpawnRing(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: early + full path identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the full path arms the object and steps the spawn ring", () => {
  const full = craft(0x01);
  oracle(full);
  assert.equal(full.mem8[REC + SPIDX], RING_SEED, "spawn index stored from the ring");
  assert.equal(full.mem8[REC + SPEED], 0xec, "initial speed seeded");
  assert.equal(full.mem8[REC + STATE], 0x01, "state advanced 0 -> 1");
  assert.equal(full.mem8[SPAWN_RING_COUNTER], (RING_SEED + 1) & 0xff, "spawn ring advanced");

  const early = craft(0x05);
  oracle(early);
  assert.equal(early.mem8[REC + FRAME], 0x04, "early path only ticks the countdown 5 -> 4");
  assert.equal(early.mem8[SPAWN_RING_COUNTER], RING_SEED, "early path does not step the ring");
  console.log("  WRITE-SET: full path arms + steps ring; early path only ticks the countdown");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong armed byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x01);
  const c = craft(0x01);
  oracle(o);
  armObjectFromSpawnRing(c);
  c.mem8[REC + SPEED] = 0x00; // BUG: the full path must have seeded the speed to 0xec
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong armed byte — it is worthless");
  assert.equal(d.addr, (REC + SPEED) & 0xffff, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong armed byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH --------------------------------------------------------------

test("SP-TOOTH: full and early paths are both seam-placeable (moved 0)", () => {
  const full = seamPlaceable(withOmittedRet, armObjectFromSpawnRing, 0x771d, craft(0x01));
  assert.equal(full.placeable, true, `full path must be seam-placeable; got: ${full.error}`);
  const early = seamPlaceable(withOmittedRet, armObjectFromSpawnRing, 0x771d, craft(0x05));
  assert.equal(early.placeable, true, `early path must be seam-placeable; got: ${early.error}`);
  console.log("  SP-TOOTH: full + early both placeable (moved 0)");
});
