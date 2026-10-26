// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for tickStatusRenderRingAndRedrawOnWrap (ROM 0x23a1, Pooyan) — the shared render phase tick.
 * Decrements the mod-8 ring counter at 0x88bd; while it stays nonzero the caller returns.
 * On wrap it borrows one from the mod-4 render phase at 0x88bc and falls into the shared
 * render tail (wrapRenderPhaseAndPaintTileTriplet), which re-renders three status fields.
 *
 * SEATING: BALANCED-WIRE. The oracle has a plain `ret nz` (net SP 0) on the still-counting
 * branch and falls through (tail) into wrapRenderPhaseAndPaintTileTriplet — itself a plain-ret routine — on wrap; net
 * SP 0 either way. A void state-machine tail: no register is read back, so the register file
 * is not compared; equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked in scratch so
 * the render tail's nested pushes drop out of the diff.
 *
 * Jobs:
 *   1. EQUAL — still-counting (ring dec, no borrow), wrap-with-mask (ring 0 -> 7, not 0xff),
 *      and borrow-and-render (ring -> 0, phase borrow, tail render): oracle == module in RAM.
 *   2. WRITE-SET — a still-counting tick touches only the ring; a wrap borrows the phase.
 *   3. TEETH — a wrong ring byte is caught by the RAM diff; a no-mask twin (0xff not 0x07) and a
 *      no-borrow twin (phase left, render skipped) each diverge from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-23a1.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_23a1 as oracle } from "../../translated/loc_23a1.js";
import { tickStatusRenderRingAndRedrawOnWrap } from "../tickStatusRenderRingAndRedrawOnWrap.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const RING = 0x88bd; // STATUS_RENDER_RING — mod-8 ring counter
const PHASE = 0x88bc; // STATUS_RENDER_PHASE — mod-4 render phase
const SP0 = 0x8ff0; // inside STACK_SCRATCH

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

function seat(m, { ring, phase = 0x02 } = {}) {
  m.regs.sp = SP0;
  m.mem.write8(RING, ring);
  m.mem.write8(PHASE, phase);
  return m;
}

const craftCounting = () => seat(BASE.clone(), { ring: 0x05 }); // dec -> 4, still counting
const craftWrap = () => seat(BASE.clone(), { ring: 0x00 }); //     dec -> 0xff & 7 = 7, counting
const craftBorrow = () => seat(BASE.clone(), { ring: 0x01 }); //   dec -> 0, borrow + render

const CASES = [
  { name: "still counting", craft: craftCounting },
  { name: "wrap with mask", craft: craftWrap },
  { name: "borrow and render", craft: craftBorrow },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: tickStatusRenderRingAndRedrawOnWrap == oracle in RAM (−stack)", () => {
  for (const cfg of CASES) {
    const o = cfg.craft();
    const c = cfg.craft();
    oracle(o);
    tickStatusRenderRingAndRedrawOnWrap(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${cfg.name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} outcomes identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: counting touches only the ring; a borrow decrements the phase", () => {
  const c = craftCounting();
  const phase0 = c.mem.read8(PHASE);
  oracle(c);
  assert.equal(c.mem.read8(RING), 0x04, "still-counting ring must decrement");
  assert.equal(c.mem.read8(PHASE), phase0, "still-counting must not touch the phase");

  const b = craftBorrow();
  const bphase0 = b.mem.read8(PHASE);
  oracle(b);
  assert.equal(b.mem.read8(RING), 0x00, "borrow leaves the ring at 0");
  assert.equal(b.mem.read8(PHASE), (bphase0 - 1) & 0xff, "borrow decrements the phase");
  console.log("  WRITE-SET: counting rings only; borrow decrements the phase");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong ring byte is CAUGHT by the RAM diff", () => {
  const o = craftCounting();
  const c = craftCounting();
  oracle(o);
  tickStatusRenderRingAndRedrawOnWrap(c);
  c.mem.write8(RING, (o.mem.read8(RING) ^ 0xff) & 0xff);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted ring byte");
  assert.equal(d.addr, RING, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: a no-mask twin (0xff not 0x07) diverges from the oracle", () => {
  const o = craftWrap();
  const twin = craftWrap();
  oracle(o); // ring 0 -> dec 0xff -> & 7 -> 0x07
  twin.mem.write8(RING, (twin.mem.read8(RING) - 1) & 0xff); // naive dec, no mod-8 mask -> 0xff
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "a missing mod-8 mask must be caught");
  assert.equal(d.addr, RING, `no-mask teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(no-mask): caught at ${hx(d.addr)}`);
});

test("TEETH: a no-borrow twin (phase left, render skipped) diverges from the oracle", () => {
  const o = craftBorrow();
  const twin = craftBorrow();
  oracle(o); // ring -> 0, phase borrowed, render tail run
  twin.mem.write8(RING, (twin.mem.read8(RING) - 1) & 0x07); // rings to 0 but forgets borrow + render
  const d = ramDiffMinusStack(o, twin);
  assert.notEqual(d, null, "a missing phase-borrow + render must be caught");
  console.log(`  TEETH(no-borrow): caught at ${hx(d.addr)}`);
});
