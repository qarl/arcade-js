// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for advanceLeadActorDescentToLanding (ROM 0x2901, Pooyan) — lead-actor state-0 step. It resets the
 * frame hold and drives the base Y down; above the floor it refreshes the derived sprite Ys and
 * (unless the tile-anim cursor holds) advances the script and tails the phase render; at the floor it
 * loads the landing shape, reseeds the record, runs two integrity self-checks over the field-attribute
 * block, and on a clean pass emits the round-select tile run.
 *
 * SEATING: BALANCED — the oracle's own exits are plain `ret`; the branch exits tail-`jp` to sibling
 * handlers (23a1/2ae8/2b9a), forwarded by the module as `return loc_XXXX(m)`. LIVE-OUT: none — the
 * dispatch epilogue reads the outcome from memory, so the register file is not compared; equivalence
 * is RAM (dumpState) minus stack scratch below the entry SP. Entry IX is the param-default bridge (rst-28 dispatch).
 *
 * Cases are CRAFTED: a plain boot does not seat this record at these Ys.
 *
 * Jobs:
 *   1. EQUAL — above-floor (script running), above-floor (script held), and at-floor (self-checks):
 *      oracle == module in RAM (−stack) across the whole callee tree.
 *   2. WRITE-SET — the running case bumps the script frame counter; the held case leaves it.
 *   3. TEETH — a wrong seeded byte in the module's result is caught by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-2901.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_2901 as oracle } from "../../translated/loc_2901.js";
import { advanceLeadActorDescentToLanding } from "../advanceLeadActorDescentToLanding.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, ACTOR_TABLE, TILE_ANIM_CURSOR } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const BASE_Y = ACTOR_TABLE + 0x04; // the record base Y (IX+0x04)
const FRAME_HOLD = ACTOR_TABLE + 0x11; // frame-hold field (IX+0x11)
const DERIVED_Y = ACTOR_TABLE + 0x4c; // a derived sprite Y written by the refresh helper
const SCRIPT_FRAME = 0x8f37; // even/odd frame counter the script-advance helper bumps
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const SCRIPT_PTR_PAGE = 0x8500; // tilemap-RAM page the script cursor rides (cf. loc_23ec/loc_2405 tests)

/** Seat the dispatch interface: IX = the lead record, world memory as the ROM booted it. */
function seat(m, { baseY = 0x50, cursor = 0x00 } = {}) {
  m.regs.ix = ACTOR_TABLE;
  m.regs.i = 0x00;
  m.regs.iff2 = false;
  m.regs.sp = SP0;
  m.mem.write8(BASE_Y, baseY);
  // TILE_ANIM_CURSOR (0x88be) is a 16-bit script pointer; its low byte doubles as the hold selector
  // advanceLeadActorDescentToLanding checks (0xf9 = held). Seat it as a FULL pointer into tilemap RAM — writing only the low
  // byte leaves the high byte 0x00, so loc_2405 dereferences the null pointer and walks into ROM.
  const ptr = (SCRIPT_PTR_PAGE & 0xff00) | (cursor & 0xff);
  m.mem.write16(TILE_ANIM_CURSOR, ptr);
  m.mem.write8(ptr, 0x10); // tile code under the cursor (< 0x37 -> advance in place, stays in RAM)
  return m;
}

const craftRunning = () => seat(BASE.clone(), { baseY: 0x50, cursor: 0x00 }); // above floor, script runs
const craftHeld = () => seat(BASE.clone(), { baseY: 0x50, cursor: 0xf9 }); //    above floor, script held
const craftFloor = () => seat(BASE.clone(), { baseY: 0xdb }); //                 reaches the floor after inc

const CASES = [
  { name: "above floor -> script running", craft: craftRunning },
  { name: "above floor -> script held", craft: craftHeld },
  { name: "at floor -> shape load + self-checks", craft: craftFloor },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: advanceLeadActorDescentToLanding == oracle in RAM (−stack) across the callee tree", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    advanceLeadActorDescentToLanding(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: running advances the script frame counter; the hold gate freezes it", () => {
  const running = craftRunning();
  const before = running.mem.read8(SCRIPT_FRAME);
  oracle(running);
  assert.notEqual(running.mem.read8(SCRIPT_FRAME), before, "the running path must bump the script frame counter");
  assert.equal(running.mem.read8(FRAME_HOLD), 0x01, "the running path resets the frame hold");
  assert.equal(running.mem.read8(DERIVED_Y), 0x51, "the running path refreshes the derived sprite Y");

  const held = craftHeld();
  const heldBefore = held.mem.read8(SCRIPT_FRAME);
  oracle(held);
  assert.equal(held.mem.read8(SCRIPT_FRAME), heldBefore, "the held path must NOT advance the script frame counter");
  console.log("  WRITE-SET: running bumps the counter; held freezes it");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong seeded byte is CAUGHT by the RAM diff", () => {
  const o = craftRunning();
  const c = craftRunning();
  oracle(o);
  advanceLeadActorDescentToLanding(c);
  c.mem.write8(FRAME_HOLD, (o.mem.read8(FRAME_HOLD) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted frame-hold byte");
  assert.equal(d.addr, FRAME_HOLD, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});
