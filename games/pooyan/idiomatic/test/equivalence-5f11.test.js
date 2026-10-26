// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for scanActorSlotsMarkStruckAndFlash (ROM 0x5f11, Pooyan) — the proximity-collision slot scan.
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and scanActorSlotsMarkStruckAndFlash on the other, compared on RAM (dumpState, minus stack scratch below the entry SP).
 * pc/SP/cycles are NOT compared, and there is no register live-out: it is tail-reached from a sweep
 * dispatcher and its output is the marked slot, the flash cell and the hit-sound ring writes. The
 * scan's advanced IX/HL/B cursors are registers no caller reads back.
 *
 * INPUTS: B (slot count), IX (paired record, stride 4), HL (slot record, stride 0x18), IY (target
 * box), I (interrupt register — its parity picks the flash cell 0x8d19 vs 0x8d1a), and
 * FLIP_SCREEN_FLAG 0x881f (read by the bounds precheck to pick the X bias). All work-RAM bases here
 * are isolated; the hit-sound run lands on the sound ring, the callee's own domain.
 *
 * Jobs:
 *   1. EQUAL — over empty / already-struck / off-screen / hit (I==0 & I!=0-negate) / dx-reject /
 *      dy-reject / two-slot-loop cases, oracle == scanActorSlotsMarkStruckAndFlash in RAM (−stack).
 *   2. WRITE-SET — a hit marks the slot struck and sets exactly its interrupt-parity flash cell
 *      (the partner cell stays clear).
 *   3. TEETH — a wrong struck-slot byte is CAUGHT by the RAM diff.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-5f11.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_5f11 as oracle } from "../../translated/loc_5f11.js";
import { scanActorSlotsMarkStruckAndFlash } from "../scanActorSlotsMarkStruckAndFlash.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const IX_REC = 0x8b00; //  paired record base (precheck reads +0, +2)
const HL_REC = 0x8c00; //  slot record base (state at +0), stride 0x18
const IY_BOX = 0x8e00; //  target box (centre at +0, +2)
const FLIP = 0x881f;
const FLASH0 = 0x8d19; //  flash cell when I == 0
const FLASH1 = 0x8d1a; //  flash cell when I != 0

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with B/IX/HL/IY/I, the flip flag, the record/box and one or two slot states seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; the precheck + tail calls only touch it there
  m.regs.b = spec.count & 0xff;
  m.regs.ix = IX_REC;
  m.regs.hl = HL_REC;
  m.regs.iy = IY_BOX;
  m.regs.i = (spec.ireg ?? 0x00) & 0xff;
  m.mem8[FLIP] = (spec.flip ?? 0x01) & 0xff;
  m.mem8[HL_REC] = (spec.slot0 ?? 0x00) & 0xff;
  if (spec.slot1 !== undefined) m.mem8[HL_REC + 0x18] = spec.slot1 & 0xff;
  m.mem8[IX_REC + 0x00] = (spec.recX ?? 0x10) & 0xff;
  m.mem8[IX_REC + 0x02] = (spec.recY ?? 0x20) & 0xff;
  m.mem8[IY_BOX + 0x00] = (spec.boxX ?? 0x18) & 0xff;
  m.mem8[IY_BOX + 0x02] = (spec.boxY ?? 0x22) & 0xff;
  return m;
}

const CASES = [
  { name: "empty slot -> skip -> ret", count: 1, slot0: 0x00 },
  { name: "already-struck slot (3) -> skip -> ret", count: 1, slot0: 0x03 },
  { name: "off-screen (biased Y >= 0xe0) -> skip", count: 1, slot0: 0x02, flip: 1, recX: 0x10, recY: 0xf0 },
  { name: "HIT I==0: mark slot + flash 0x8d19", count: 1, slot0: 0x01, ireg: 0x00, flip: 1,
    recX: 0x10, recY: 0x20, boxX: 0x18, boxY: 0x22 },
  { name: "HIT I!=0 (both diffs via negate): mark slot + flash 0x8d1a", count: 1, slot0: 0x01, ireg: 0x01,
    flip: 0, recX: 0x30, recY: 0x10, boxX: 0x2a, boxY: 0x0c },
  { name: "dx reject (|dx| >= 7) -> skip", count: 1, slot0: 0x02, flip: 1, recX: 0x10, recY: 0x20, boxX: 0x30 },
  { name: "dy reject (|dy| >= 6) -> skip", count: 1, slot0: 0x02, flip: 1, recX: 0x10, recY: 0x20,
    boxX: 0x18, boxY: 0x40 },
  { name: "two-slot loop: iter1 dx-reject, iter2 empty -> ret", count: 2, slot0: 0x02, slot1: 0x00,
    flip: 1, recX: 0x10, recY: 0x20, boxX: 0x30 },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted scan cases — scanActorSlotsMarkStruckAndFlash == oracle in RAM (−stack)", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    scanActorSlotsMarkStruckAndFlash(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted scan cases identical (RAM −stack)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: a hit marks the slot struck and sets exactly its parity flash cell", () => {
  const i0 = craft(CASES[3]); // I == 0 -> flash 0x8d19
  oracle(i0);
  assert.equal(i0.mem8[HL_REC], 0x03, "I==0: slot marked struck");
  assert.equal(i0.mem8[FLASH0], 0x01, "I==0: flash 0x8d19 set");
  assert.equal(i0.mem8[FLASH1], 0x00, "I==0: partner flash 0x8d1a stays clear");

  const i1 = craft(CASES[4]); // I != 0 -> flash 0x8d1a
  oracle(i1);
  assert.equal(i1.mem8[HL_REC], 0x03, "I!=0: slot marked struck");
  assert.equal(i1.mem8[FLASH1], 0x01, "I!=0: flash 0x8d1a set");
  assert.equal(i1.mem8[FLASH0], 0x00, "I!=0: partner flash 0x8d19 stays clear");
  console.log(`  WRITE-SET: slot := 3 + the parity flash cell (hit-sound ring = callee domain)`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong struck-slot byte is CAUGHT by the RAM diff", () => {
  const spec = CASES[3];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  scanActorSlotsMarkStruckAndFlash(c);
  c.mem8[HL_REC] = 0x00; // BUG: a hit must mark the slot 0x03

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong struck-slot byte — it is worthless");
  assert.equal(d.addr, HL_REC, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong struck slot caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});
