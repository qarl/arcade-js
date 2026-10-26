// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence gate for accrueCreditFromDripRingA — per-frame accumulate step, variant A.
 *
 * Each frame the routine rotates INPUT_PORT0 bit2 into the cadence ring. When the ring's low three
 * bits settle on the fire phase (1) it emits the drip sound (emitPresetSound) and adds one to the running
 * total through the shared accumulate tail (addCreditsAndQueueDisplay); off-phase it leaves only the advanced ring.
 * The module composes the real idiomatic siblings; the oracle drives their translated forms through
 * the routines map. accrueCreditFromDripRingA has no register live-out (the caller reloads A before reading it), so
 * only RAM (dumpState, minus stack scratch below the entry SP) is compared. SP sits in STACK_SCRATCH so the accumulate
 * tail's nested pushes drop out of the diff.
 *
 * Jobs:
 *   1. EQUAL — off-phase (ring advances only), a fire (ring advances + total += 1), and a wrap fire
 *      (bit7 shifted out) all land oracle == module in RAM (−stack).
 *   2. WRITE-SET — off-phase leaves the total untouched and only advances the ring; a fire advances
 *      the ring AND bumps the total.
 *   3. TEETH — a wrong ring byte is caught by the RAM diff; a spuriously-fired total (bumped when
 *      the off-phase step must not) is caught at the total byte.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5a06.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5a06 as oracle } from "../../translated/loc_5a06.js";
import { accrueCreditFromDripRingA } from "../accrueCreditFromDripRingA.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH, INPUT_PORT0, CREDIT_COUNT } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const DRIP_RING_A = 0x8829; // proposed cell (see reconcile) — the variant-A cadence ring
const SP0 = 0x8fe0; // inside STACK_SCRATCH; the accumulate tail pushes/pops its frames here

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the input bit, the ring seed and the running total on a fresh clone. */
function craft({ ring, input, credit = 0x00 }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  for (let i = 0; i < 8; i++) m.mem.write8(SP0 + i, 0x00); // dummy dead-stack return frames
  m.mem.write8(DRIP_RING_A, ring);
  m.mem.write8(INPUT_PORT0, input);
  m.mem.write8(CREDIT_COUNT, credit);
  return m;
}

const OFF = { ring: 0x02, input: 0x00, credit: 0x10 }; // (0x02<<1)|0 = 0x04; low3 = 4 != 1 -> no fire
const FIRE = { ring: 0x00, input: 0x04, credit: 0x00 }; // bit2 set -> (0<<1)|1 = 0x01; low3 = 1 -> fire
const WRAP = { ring: 0x80, input: 0x04, credit: 0x00 }; // (0x80<<1)|1 & 0xff = 0x01 -> fire (bit7 dropped)

const CASES = [
  { name: "off-phase (ring advances only)", cfg: OFF, fires: false, ring: 0x04 },
  { name: "fire (ring advances + total bump)", cfg: FIRE, fires: true, ring: 0x01 },
  { name: "wrap fire (bit7 shifted out)", cfg: WRAP, fires: true, ring: 0x01 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: accrueCreditFromDripRingA == oracle in RAM (−stack)", () => {
  for (const { name, cfg } of CASES) {
    const o = craft(cfg);
    const c = craft(cfg);
    oracle(o);
    accrueCreditFromDripRingA(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} states identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: off-phase advances only the ring; a fire also bumps the total", () => {
  const off = craft(OFF);
  oracle(off);
  assert.equal(off.mem.read8(DRIP_RING_A), 0x04, "off-phase must advance the ring");
  assert.equal(off.mem.read8(CREDIT_COUNT), 0x10, "off-phase must leave the total untouched");

  const fire = craft(FIRE);
  oracle(fire);
  assert.equal(fire.mem.read8(DRIP_RING_A), 0x01, "a fire must advance the ring");
  assert.equal(fire.mem.read8(CREDIT_COUNT), 0x01, "a fire must bump the total by one");
  console.log("  WRITE-SET: off-phase ring-only; fire bumps the total");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is caught by the RAM diff", () => {
  const o = craft(OFF);
  const c = craft(OFF);
  oracle(o);
  accrueCreditFromDripRingA(c);
  c.mem.write8(DRIP_RING_A, (o.mem.read8(DRIP_RING_A) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted ring byte");
  assert.equal(d.addr, DRIP_RING_A, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): wrong ring caught at ${hx(d.addr)}`);
});

test("TEETH: a spuriously-fired total (off-phase must not accumulate) is caught", () => {
  const o = craft(OFF);
  const c = craft(OFF);
  oracle(o);
  accrueCreditFromDripRingA(c);
  assert.equal(c.mem.read8(CREDIT_COUNT), 0x10, "sanity: off-phase left the total untouched");
  c.mem.write8(CREDIT_COUNT, 0x11); // BUG: a step that wrongly fired would bump the total
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a spurious accumulate");
  assert.equal(d.addr, CREDIT_COUNT, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(fire): a spurious accumulate is caught at ${hx(d.addr)}`);
});
