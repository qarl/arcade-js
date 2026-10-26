// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for appendWriteAnimBlockRowOnPhase (ROM 0x7f5d, Pooyan) — rst-0x28 write-anim dispatch handler
 * (dispatch-table entry 2). It rotates bit 4 of the byte at *(0x8e21) into the phase ring 0x8e29;
 * unless the ring's low three bits land on phase 1 it returns (the ROM `ret nz`). On the 1-phase it
 * seeds 0x8e2b, appends (0x8e23) through the write-pointer 0x8e1f, and decrements the row countdown
 * 0x8e25 — draining it tail-delegates to floodWriteAnimCellsAndLatchPhase, otherwise it does the per-row write at *(0x8e27).
 *
 * appendWriteAnimBlockRowOnPhase is a void handler (no register live-out), so the register file is not compared; equivalence
 * is RAM (dumpState) minus stack scratch below the entry SP. SP is parked in STACK_SCRATCH so the drained path's nested
 * pushes (the tail's m.call chain) drop out of the diff.
 *
 * Both load-bearing branches are driven on BOTH arms:
 *   - the phase gate: an off-phase case (early return, only the ring moved) and an on-phase case;
 *   - the countdown: a NOT-drained case (the per-row write path) and a DRAINED case (tail -> floodWriteAnimCellsAndLatchPhase).
 *
 * Jobs:
 *   1. EQUAL — over off-phase / on-phase-not-drained / on-phase-drained, oracle == appendWriteAnimBlockRowOnPhase, RAM (−stack).
 *   2. WRITE-SET — the on-phase-not-drained path's key cells hold their exact expected values.
 *   3. TEETH(RAM) — a corrupted module output byte is caught by the RAM diff.
 *   4. TEETH(tail) — a twin that omits the drained tail-delegation DIVERGES from the oracle.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-7f5d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_7f5d as oracle } from "../../translated/loc_7f5d.js";
import { appendWriteAnimBlockRowOnPhase } from "../appendWriteAnimBlockRowOnPhase.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

const SP0 = 0x8ff0; //          parked inside STACK_SCRATCH (0x8fc0-0x9000)
const inDeadStack = deadStackBelow(STACK_SCRATCH, SP0);
const SRC_PTR = 0x8d00; //      *(0x8e21) points here; its byte's bit 4 feeds the ring
const APPEND_TARGET = 0x8c00; // *(0x8e1f) points here (write RAM)
const ROW_TARGET = 0x8c80; //   *(0x8e27) points here; backed up to 0x8c60

function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

/** Seat the common cluster; `bit4` picks the source byte's bit 4, `ring0` the ring, `count` the countdown. */
function craft({ bit4, ring0, count }) {
  const m = BASE.clone();
  m.regs.sp = SP0;
  m.mem.write16(0x8e21, SRC_PTR);
  m.mem.write8(SRC_PTR, bit4 ? 0x10 : 0x00); // bit 4 is the only bit the four rlca keep
  m.mem.write8(0x8e29, ring0); //              phase ring
  m.mem.write16(0x8e1f, APPEND_TARGET); //     append write-pointer
  m.mem.write8(0x8e23, 0x55); //               append source / reprime source
  m.mem.write16(0x8e27, ROW_TARGET); //        row write-pointer
  m.mem.write8(0x8e25, count); //              row countdown
  m.mem.write8(0x8e26, 0x00); //               row flag (set to 1 on a row step)
  m.mem.write16(0x8e2b, 0x0000); //            seeded to 0x03a0 on the 1-phase
  m.mem.write8(0x8808, 0x00); //               floodWriteAnimCellsAndLatchPhase's shared latch (0x80 only via the tail)
  m.mem.write8(0x8e2a, 0x00); //               floodWriteAnimCellsAndLatchPhase's done flag (1 only via the tail)
  return m;
}

// ring0=0x00 + bit4=1 -> rotated 0x01 -> (0x01&7)==1 : on-phase.
// ring0=0x00 + bit4=0 -> rotated 0x00 -> (0x00&7)==0 : off-phase (early return).
const OFF_PHASE = { bit4: 0, ring0: 0x00, count: 0x02 };
const ON_NOT_DRAINED = { bit4: 1, ring0: 0x00, count: 0x02 }; // 0x02 -> 0x01, not drained
const ON_DRAINED = { bit4: 1, ring0: 0x00, count: 0x01 }; //     0x01 -> 0x00, drained -> floodWriteAnimCellsAndLatchPhase

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: appendWriteAnimBlockRowOnPhase == oracle in RAM (−stack) across both gate arms and both countdown arms", () => {
  for (const [name, seed] of [
    ["off-phase", OFF_PHASE],
    ["on-phase/not-drained", ON_NOT_DRAINED],
    ["on-phase/drained->tail", ON_DRAINED],
  ]) {
    const o = craft(seed);
    const c = craft(seed);
    oracle(o);
    appendWriteAnimBlockRowOnPhase(c);
    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `${name}: RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
  }
  console.log("  EQUAL: off-phase + on-phase(not-drained) + on-phase(drained->tail) identical (RAM −stack)");
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the on-phase/not-drained path writes its exact expected cells", () => {
  const o = craft(ON_NOT_DRAINED);
  oracle(o);
  const r8 = (a) => o.mem.read8(a);
  const r16 = (a) => o.mem.read16(a);

  assert.equal(r8(0x8e29), 0x01, "phase ring rotated to 1 (bit 4 shifted in)");
  assert.equal(r16(0x8e2b), 0x03a0, "0x8e2b seeded to 0x03a0");
  assert.equal(r8(APPEND_TARGET), 0x55, "(0x8e23) appended at the write-pointer target");
  assert.equal(r16(0x8e1f), APPEND_TARGET + 1, "append pointer advanced +1");
  assert.equal(r8(0x8e25), 0x01, "row countdown decremented (2 -> 1)");
  assert.equal(r8(ROW_TARGET), 0x55, "(0x8e23) written at the row pointer");
  assert.equal(r16(0x8e27), ROW_TARGET - 0x20, "row pointer backed up one row (0x20)");
  assert.equal(r8(ROW_TARGET - 0x20), 0x11, "0x11 seeded at the backed-up row pointer");
  assert.equal(r8(0x8e26), 0x01, "row flag set");
  assert.equal(r8(0x8e23), 0x11, "(0x8e23) re-primed to 0x11");
  console.log("  WRITE-SET: ring, 0x8e2b seed, append + pointer, countdown, row write + reprime");
});

// -- 3 & 4. TEETH -------------------------------------------------------------

test("TEETH(RAM): a corrupted module output byte is CAUGHT by the RAM diff", () => {
  const o = craft(ON_NOT_DRAINED);
  const c = craft(ON_NOT_DRAINED);
  oracle(o);
  appendWriteAnimBlockRowOnPhase(c);
  assert.equal(ramDiffMinusStack(o, c), null, "sanity: identical before corruption");
  c.mem.write16(0x8e2b, 0x0000); // BUG: undo the 1-phase seed
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a corrupted output byte");
  console.log(`  TEETH(RAM): caught at ${hx(d.addr ?? 0)} (oracle=${d.a} broken=${d.b})`);
});

/** A twin identical to the module up to the countdown, but on the drained arm it just returns
 * instead of tail-delegating to floodWriteAnimCellsAndLatchPhase — proving the delegation is load-bearing. */
function twinNoTail(m) {
  const { mem8, mem16 } = m;
  const src = mem8[mem16[0x8e21]];
  const ring = ((mem8[0x8e29] << 1) | ((src >> 4) & 1)) & 0xff;
  mem8[0x8e29] = ring;
  if ((ring & 0x07) !== 0x01) return;
  mem16[0x8e2b] = 0x03a0;
  const appendPtr = mem16[0x8e1f];
  mem8[appendPtr] = mem8[0x8e23];
  mem16[0x8e1f] = (appendPtr + 1) & 0xffff;
  const countdown = (mem8[0x8e25] - 1) & 0xff;
  mem8[0x8e25] = countdown;
  if (countdown === 0) return; // BUG: drops the tail delegation to floodWriteAnimCellsAndLatchPhase
  const rowPtr = mem16[0x8e27];
  mem8[rowPtr] = mem8[0x8e23];
  const backed = (rowPtr - 0x20) & 0xffff;
  mem16[0x8e27] = backed;
  mem8[backed] = 0x11;
  mem8[0x8e26] = 0x01;
  mem8[0x8e23] = 0x11;
}

test("TEETH(tail): a twin omitting the drained tail-delegation DIVERGES from the oracle", () => {
  const o = craft(ON_DRAINED);
  const c = craft(ON_DRAINED);
  oracle(o);
  twinNoTail(c);
  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "omitting the tail delegation to floodWriteAnimCellsAndLatchPhase must diverge");
  console.log(`  TEETH(tail): omission caught at ${hx(d.addr ?? 0)}`);
});
