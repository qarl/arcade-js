// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for moveObject (ROM 0x7740, Pooyan) — the active-object mover (rst-28 state
 * 1): step the position by the signed speed, and on a cell crossing advance the state, reload the
 * frame timer, fire sound + animation, and run a ROM checksum guard.
 *
 * The module dissolves advanceObjectAnimationFrame (anim step), fetchWordFromTableIndex (anim-word lookup) and the rst-20 guard adds
 * (fetchByteFromTableIndex) into direct calls, and keeps the two frozen helpers (loc_0ef1 sound, loc_381e anim-set)
 * as m.call. moveObject is a void per-object step (no register survives), so equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in dead stack.
 *
 * The anim hold (rec+0x0e) is seated non-zero so advanceObjectAnimationFrame just decrements it (no stream walk), and
 * the speed is 0 (no position move / borrow). The crossing arm holds the sub-position low nibble
 * below 9 so the object crosses (state advance + sound + anim + guard run); the no-cross arm holds it
 * at/above 9 so the routine returns after the position step.
 *
 * Jobs:
 *   1. EQUAL — crossing and no-cross: oracle == moveObject in RAM (−stack).
 *   2. WRITE-SET — crossing advances the state (rec+2); no-cross holds it, so they differ.
 *   3. TEETH — a wrong state byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7740.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7740 as oracle } from "../../translated/loc_7740.js";
import { moveObject } from "../moveObject.js";
import { Machine, withOmittedRet } from "../../machine.js";
import { deadStackBelow, firstStateDiff, seamPlaceable } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC = 0x8c60; //     object record base
const STATE = REC + 0x02; //  state byte, advanced on a cell crossing
const POS = REC + 0x03; //    position byte
const SUB = REC + 0x04; //    sub-position byte (low 5 bits gate the crossing)
const SPEED = REC + 0x0a; //  signed speed
const HOLD = REC + 0x0e; //   anim frame-hold (advanceObjectAnimationFrame)
const TIMER = REC + 0x11; //  frame timer, reloaded on a crossing
const ANIMIDX = REC + 0x17; // sprite/anim index (fetchWordFromTableIndex table key)
const SP0 = 0x8ff0; //     inside STACK_SCRATCH
const CALLER_RET = 0xfffc; // caller's return word the seam completes on the moved-0 arm

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: anim held (advanceObjectAnimationFrame no-ops), speed 0 (no move), state 1; `sub` sets the crossing. */
function craft(sub) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.regs.ix = REC;
  m.mem8[HOLD] = 0x05; // advanceObjectAnimationFrame: decrement the hold and return (no stream walk)
  m.mem8[SPEED] = 0x00; // no position move, no borrow
  m.mem8[POS] = 0x10;
  m.mem8[SUB] = sub & 0xff;
  m.mem8[ANIMIDX] = 0x00;
  m.mem8[STATE] = 0x01;
  m.mem8[TIMER] = 0x00;
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crossing + no-cross states — moveObject == oracle in RAM (−stack)", () => {
  for (const [label, sub] of [["crossing (sub 0x08)", 0x08], ["no-cross (sub 0x10)", 0x10]]) {
    const o = craft(sub);
    oracle(o);
    const c = craft(sub);
    moveObject(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${label}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: crossing + no-cross identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the sub-position gates the cell crossing (state advance)", () => {
  const cross = craft(0x08);
  oracle(cross);
  assert.equal(cross.mem8[STATE], 0x02, "crossing -> state advanced 1 -> 2");

  const hold = craft(0x10);
  oracle(hold);
  assert.equal(hold.mem8[STATE], 0x01, "no crossing -> state held");

  assert.notEqual(cross.mem8[STATE], hold.mem8[STATE], "the sub-position must gate the crossing");
  console.log("  WRITE-SET: crossing advances the state, no-cross holds it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong state byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x08);
  const c = craft(0x08);
  oracle(o);
  moveObject(c);
  c.mem8[STATE] = 0x01; // BUG: the crossing must have advanced the state to 0x02
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong state byte — it is worthless");
  assert.equal(d.addr, STATE, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong state byte caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

// -- 4. SP-TOOTH (R36) --------------------------------------------------------

test("SP-TOOTH: moveObject (rst-28 state-1 wired override) is seam-placeable", () => {
  const m = craft(0x08); // crossing arm: all sub-calls direct -> SP nets 0
  m.mem8[SP0] = CALLER_RET & 0xff;
  m.mem8[SP0 + 1] = CALLER_RET >> 8; // seat the caller's return word the seam completes
  const r = seamPlaceable(withOmittedRet, moveObject, 0x7740, m);
  assert.equal(r.placeable, true, `moveObject must be seam-placeable; got: ${r.error}`);
  console.log("  SP-TOOTH: moveObject seam-placeable (moved 0, seam completes the ret)");
});
