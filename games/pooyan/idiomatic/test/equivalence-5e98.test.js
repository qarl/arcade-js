// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for dispatchTargetPairCollisionSweep (ROM 0x5e98, Pooyan) — the per-slot actor-sweep entry.
 * The interrupt-parity register picks one of the two pair records (0x8c90 / 0x8ca8); an inactive
 * pair (lead bit0 clear) returns at once. An active pair is latched at 0x8d65 and its bit1 selects
 * one of two sweep variants (bit1 set -> scanActorSlotsMarkStruckAndFlash; bit1 clear -> testAndCatchActorSlotOnOverlap) over four
 * coordinate(0x8888)/state(0x8c30) records with the caller's IY target box.
 *
 * SEATING: TAIL-CALL (both variants) + a BALANCED early ret; the caller ignores the result, so
 * dispatchTargetPairCollisionSweep is void — equivalence is RAM (dumpState) minus stack scratch below the entry SP, SP parked there so the
 * variants' nested pushes drop out of the diff. The oracle drives the translated variants through
 * the routines map; the module calls the idiomatic variants directly.
 *
 * ⚠ CROSS-AGENT: testAndCatchActorSlotOnOverlap (the bit1-clear variant) is an in-batch sibling not yet authored. This
 * gate imports it via dispatchTargetPairCollisionSweep and assumes it lands with the family contract
 * `(m, count, ix, hl, iy, ireg)` — the exact signature of its sibling scanActorSlotsMarkStruckAndFlash. If the sibling's
 * param order differs the LEAD reconciles the call at merge; the bit1-clear cases below are the
 * ones that exercise it. The bit1-set (scanActorSlotsMarkStruckAndFlash) and inactive cases resolve immediately.
 *
 * Empty formation slots gate both variants to a no-op sweep, isolating dispatchTargetPairCollisionSweep's own job (the
 * parity select + bit0 gate + 0x8d65 latch + variant dispatch); one live case drives scanActorSlotsMarkStruckAndFlash to a
 * real hit so correct dispatch is observable at the struck slot.
 *
 * Jobs:
 *   1. EQUAL — inactive, variant-A/B empty, parity variant, and a variant-A live hit: module ==
 *      oracle in RAM (−stack).
 *   2. WRITE-SET — inactive is inert; an active sweep latches the selected pair pointer at 0x8d65;
 *      the live hit marks the struck slot 0x03 (proving scanActorSlotsMarkStruckAndFlash, not testAndCatchActorSlotOnOverlap, ran).
 *   3. TEETH — a corrupted latch byte is caught by the diff; the parity select latches distinct
 *      pointers for I==0 vs I!=0; the live hit's struck-slot marking pins the variant choice.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5e98.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5e98 as oracle } from "../../translated/loc_5e98.js";
import { dispatchTargetPairCollisionSweep } from "../dispatchTargetPairCollisionSweep.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const REC0 = 0x8c90; //   pair record for I == 0
const REC1 = 0x8ca8; //   pair record for I != 0
const PAIR_PTR = 0x8d65; // the latched active-pair pointer
const FORMATION = 0x8c30; // slot state records, stride 0x18
const COORD = 0x8888; //   slot coordinate records, stride 0x04
const FLIP = 0x881f;
const FLASH0 = 0x8d19; //  scanActorSlotsMarkStruckAndFlash's I==0 flash cell
const IY_BOX = 0x8e00; //  target box in scratch work-RAM
const STRIDE = 0x18;
const STRUCK = 0x03;
const SP0 = 0x8ff0; //     inside STACK_SCRATCH
const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Fresh clone: parity register, target box, empty formation slots, and the selected pair's lead. */
function craft(spec = {}) {
  const m = BASE.clone();
  const ireg = spec.ireg ?? 0x00;
  m.regs.sp = SP0;
  m.regs.i = ireg & 0xff;
  m.regs.iy = IY_BOX;
  for (let n = 0; n < 4; n++) m.mem8[FORMATION + n * STRIDE] = 0x00; // empty sweep by default
  m.mem8[(ireg === 0 ? REC0 : REC1)] = (spec.lead ?? 0x00) & 0xff;
  m.mem8[FLIP] = (spec.flip ?? 0x01) & 0xff;
  if (spec.hit) {
    m.mem8[FORMATION] = 0x01; //          slot0 live
    m.mem8[COORD + 0x00] = 0x10; //       slot0 coord X
    m.mem8[COORD + 0x02] = 0x20; //       slot0 coord Y
    m.mem8[IY_BOX + 0x00] = 0x18; //      box X (|dx| in scanActorSlotsMarkStruckAndFlash's window)
    m.mem8[IY_BOX + 0x02] = 0x22; //      box Y (|dy| in window)
  }
  return m;
}

const CASES = [
  { name: "inactive pair (bit0 clear) -> ret", spec: { ireg: 0, lead: 0x00 } },
  { name: "variant A empty (bit1 set)", spec: { ireg: 0, lead: 0x03 } },
  { name: "variant B empty (bit1 clear)", spec: { ireg: 0, lead: 0x01 } },
  { name: "parity I!=0, variant B empty", spec: { ireg: 1, lead: 0x01 } },
  { name: "variant A live hit", spec: { ireg: 0, lead: 0x03, hit: true, flip: 1 } },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: dispatchTargetPairCollisionSweep == oracle in RAM (−stack)", () => {
  for (const { name, spec } of CASES) {
    const o = craft(spec);
    const c = craft(spec);
    oracle(o);
    dispatchTargetPairCollisionSweep(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} sweeps identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: inactive is inert; an active sweep latches the pair; a hit marks the struck slot", () => {
  const inert = craft({ ireg: 0, lead: 0x00 });
  const b0 = inert.dumpState();
  dispatchTargetPairCollisionSweep(inert);
  assert.deepEqual([...inert.dumpState()], [...b0], "an inactive pair must leave RAM untouched");

  const active = craft({ ireg: 0, lead: 0x03 });
  dispatchTargetPairCollisionSweep(active);
  assert.equal(active.mem16[PAIR_PTR] & 0xffff, REC0, "an active pair latches its pointer at 0x8d65");

  const hit = craft({ ireg: 0, lead: 0x03, hit: true, flip: 1 });
  dispatchTargetPairCollisionSweep(hit);
  assert.equal(hit.mem8[FORMATION], STRUCK, "the live hit marks slot0 struck (variant A ran)");
  assert.equal(hit.mem8[FLASH0], 0x01, "the live hit sets the I==0 flash cell");
  console.log("  WRITE-SET: inactive inert; latch at 0x8d65; hit -> slot 0x03");
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a corrupted latch byte is CAUGHT by the RAM diff", () => {
  const o = craft({ ireg: 0, lead: 0x03 });
  const c = craft({ ireg: 0, lead: 0x03 });
  oracle(o);
  dispatchTargetPairCollisionSweep(c);
  c.mem8[PAIR_PTR] ^= 0xff; // BUG: corrupt the latched pointer
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted latch");
  assert.equal(d.addr, PAIR_PTR, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH(RAM): caught at ${hx(d.addr)}`);
});

test("TEETH: the parity select latches distinct pointers for I==0 vs I!=0", () => {
  const i0 = craft({ ireg: 0, lead: 0x03 });
  const i1 = craft({ ireg: 1, lead: 0x03 });
  dispatchTargetPairCollisionSweep(i0);
  dispatchTargetPairCollisionSweep(i1);
  assert.equal(i0.mem16[PAIR_PTR] & 0xffff, REC0, "I==0 must latch the first pair");
  assert.equal(i1.mem16[PAIR_PTR] & 0xffff, REC1, "I!=0 must latch the second pair");
  assert.notEqual(i0.mem16[PAIR_PTR] & 0xffff, i1.mem16[PAIR_PTR] & 0xffff, "a parity-blind select is rejected");
  console.log(`  TEETH(parity): I==0 -> ${hx(REC0)}, I!=0 -> ${hx(REC1)}`);
});

test("TEETH: the live hit's struck slot pins the variant choice", () => {
  const o = craft({ ireg: 0, lead: 0x03, hit: true, flip: 1 });
  oracle(o);
  assert.equal(o.mem8[FORMATION], STRUCK, "variant A (scanActorSlotsMarkStruckAndFlash) marks the slot struck");
  // a bit1-clear dispatch would instead run testAndCatchActorSlotOnOverlap, which never writes 0x03 to slot0's lead
  const c = craft({ ireg: 0, lead: 0x03, hit: true, flip: 1 });
  dispatchTargetPairCollisionSweep(c);
  assert.equal(c.mem8[FORMATION], STRUCK, "the module dispatched variant A on bit1 set");
  console.log("  TEETH(variant): bit1 set -> struck slot 0x03");
});
