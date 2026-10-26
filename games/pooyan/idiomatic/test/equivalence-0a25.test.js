// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for primeAttractAnimAndPaintTileBlocks (ROM 0x0a25, Pooyan) — seeds the frame-animation cursor
 * then tail-hands to the two-slot tile painter: advance the 4-phase counter, look its frame word
 * up in a ROM table, and paint the same 2x2 source into two screen slots.
 *
 * SEATING: TAIL-CALL. The oracle loads HL then falls straight through into the painter (whose own
 * tail rets to this routine's caller); its effective seating is the delegatee's (BALANCED). The
 * module returns the painter's result directly. No register survives that a caller reads back
 * (the caller overwrites HL immediately), so the register file is not compared; equivalence is RAM
 * (dumpState) minus stack scratch below the entry SP, SP parked in STACK_SCRATCH so nested pushes drop out.
 *
 * Cases are CRAFTED: the cursor seed is set so the phase index is deterministic.
 *
 * Jobs:
 *   1. EQUAL — module == oracle in RAM (−stack), across two phase seeds.
 *   2. WRITE-SET — the cursor hi is seeded to 0x0a and the phase counter advances by one.
 *   3. TEETH — a corrupted output byte is caught by the RAM diff; a routine that never ran leaves
 *      the cursor hi at its pre-dirty seed, which the write-set catches.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-0a25.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_0a25 as oracle } from "../../translated/loc_0a25.js";
import { primeAttractAnimAndPaintTileBlocks } from "../primeAttractAnimAndPaintTileBlocks.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const FRAME_HI = 0x8d41; // ANIM_FRAME_COUNTER (cursor hi, seeded to 0x0a)
const FRAME_LO = 0x8d40; // phase counter (advanced, & 0x03 -> table index)
const SP0 = 0x8ff0; //     inside STACK_SCRATCH
const PRE = 0xee; //       pre-dirty cursor-hi seed

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function craft(phaseSeed = 0x00) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write8(FRAME_LO, phaseSeed); // fixes the phase index (& 0x03)
  m.mem.write8(FRAME_HI, PRE); //      overwritten to 0x0a by the routine
  return m;
}

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: primeAttractAnimAndPaintTileBlocks == oracle in RAM (−stack)", () => {
  for (const seed of [0x00, 0x03]) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    primeAttractAnimAndPaintTileBlocks(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `seed ${hx(seed)}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: RAM identical across phase seeds");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: cursor hi seeded to 0x0a and the phase counter advances by one", () => {
  const o = craft(0x00);
  oracle(o);
  assert.equal(o.mem.read8(FRAME_HI), 0x0a, "cursor hi must be seeded to 0x0a");
  assert.equal(o.mem.read8(FRAME_LO), 0x01, "phase counter must advance 0x00 -> 0x01");
  console.log("  WRITE-SET: cursor seeded, phase advanced");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted output byte is CAUGHT by the RAM diff", () => {
  const o = craft(0x00);
  const c = craft(0x00);
  oracle(o);
  primeAttractAnimAndPaintTileBlocks(c);
  c.mem.write8(FRAME_HI, (o.mem.read8(FRAME_HI) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted output byte");
  assert.equal(d.addr, FRAME_HI, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a routine that never ran leaves the cursor hi at its pre-dirty seed", () => {
  const never = craft(0x00);
  const ran = craft(0x00);
  oracle(ran);
  assert.equal(never.mem.read8(FRAME_HI), PRE, "control: unran cursor hi must still be the seed");
  assert.notEqual(ran.mem.read8(FRAME_HI), PRE, "teeth: the run must overwrite the seed");
  console.log("  TEETH(write-set): unran cursor stays at seed, ran cursor moves");
});
