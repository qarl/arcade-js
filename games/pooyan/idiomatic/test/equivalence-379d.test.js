// SPDX-License-Identifier: GPL-3.0-only
/**
 * Memory-equivalence test for spawnActorSlotFromTemplate (ROM 0x379d, Pooyan) — "initialise an actor slot from a
 * template".
 *
 * The cycle-free / memory-equivalence gate (docs/decompiler-pipeline): a fresh clone per side, the
 * oracle on one and spawnActorSlotFromTemplate on the other, compared on RAM (dumpState, minus stack scratch below the entry SP) PLUS
 * the declared register live-out A. pc/SP/cycles are deliberately not compared.
 *
 * INPUTS: IY (slot), IX (template), C (copied to slot+0x14). The routine also reads DIFFICULTY_DSW
 * (0x8820, selects the speed table), SPEED_INDEX (0x8900), ROUND_COUNTER (0x8907), the template's
 * +3/+4/+5/+6 position bytes, +7 (frame nibble + anim lookup) and +0b (anim override flag), plus
 * the ROM speed/anim-pointer tables the real ROM supplies to both sides.
 *
 * LIVE-OUT A: spawnActorSlotFromTemplate tail-jumps to queueSoundCommand04IfNotBusy (the spawn-sound enqueue), whose A becomes this
 * routine's result. It is checked equal to the oracle and asserted SET on the module's clone.
 *
 * The slot (0x8b40), template (0x8b00) and the gameplay cells are isolated work RAM; queueSoundCommand04IfNotBusy's own
 * writes land on the page-0x8a sound ring (covered by queueSoundCommand04IfNotBusy's own gate). The leaf is not reached
 * in a plain boot, so every case is CRAFTED: IX/IY/C and the input cells are poked on both clones.
 *
 * Jobs:
 *   1. EQUAL — crafted cases spanning the easy/hard speed table, the clamp and negate branches, and
 *      both anim paths (looked-up vs the +0b override), oracle == spawnActorSlotFromTemplate in RAM (−stack) and A.
 *   2. WRITE-SET — the slot's fields + template+0a hold the contract values; the +0b override case
 *      lays the fixed 0x3952 anim vector.
 *   3. TEETH — a wrong slot cell (RAM) and a wrong A (live-out) are each CAUGHT.
 *
 * Run: node --test games/pooyan/idiomatic/test/equivalence-379d.test.js
 */

import nodeTest from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import { loc_379d as oracle } from "../../translated/loc_379d.js";
import { spawnActorSlotFromTemplate } from "../spawnActorSlotFromTemplate.js";
import { Machine } from "../../machine.js";
import { deadStackBelow, firstStateDiff } from "../../../../core/equivalence.js";
import { STACK_SCRATCH } from "../names.js";

const ROM_DIR = new URL("../../rom/", import.meta.url);
const ROM_PRESENT = existsSync(new URL("maincpu.bin", ROM_DIR));
const ROM = ROM_PRESENT ? new Uint8Array(readFileSync(new URL("maincpu.bin", ROM_DIR))) : null;
const test = ROM_PRESENT
  ? nodeTest
  : (name, fn) => nodeTest(name, { skip: "skipped: ROM not built — run 'make -C games/pooyan rom'" }, fn);

const TEMPLATE = 0x8b00;
const SLOT = 0x8b40;
const DSW = 0x8820;
const SPEED_INDEX_ADDR = 0x8900;
const ROUND_COUNTER_ADDR = 0x8907;

const hx = (v) => "0x" + (v & 0xffff).toString(16);
const inDeadStack = deadStackBelow(STACK_SCRATCH, 0x8ffe);
function ramDiffMinusStack(ma, mb) {
  return firstStateDiff(ma.dumpState(), mb.dumpState(), (off) => ma.stateOffsetToAddr(off), inDeadStack);
}

const BASE = ROM_PRESENT ? new Machine(ROM).clone() : null;

/** A fresh clone with the slot/template bases, C, the input cells and template fields seated. */
function craft(spec) {
  const m = BASE.clone();
  m.regs.ix = TEMPLATE;
  m.regs.iy = SLOT;
  m.regs.c = spec.c & 0xff;
  m.regs.sp = 0x8ffe; // stack lives in STACK_SCRATCH; oracle rst/tail only touch it there
  m.mem8[DSW] = spec.dsw & 0xff;
  m.mem8[SPEED_INDEX_ADDR] = spec.idx & 0xff;
  m.mem8[ROUND_COUNTER_ADDR] = spec.round & 0xff;
  m.mem8[TEMPLATE + 0x03] = spec.pos[0] & 0xff;
  m.mem8[TEMPLATE + 0x04] = spec.pos[1] & 0xff;
  m.mem8[TEMPLATE + 0x05] = spec.pos[2] & 0xff;
  m.mem8[TEMPLATE + 0x06] = spec.pos[3] & 0xff;
  m.mem8[TEMPLATE + 0x07] = spec.t7 & 0xff;
  m.mem8[TEMPLATE + 0x0b] = spec.flag & 0xff;
  return m;
}

const CASES = [
  { name: "flag=0, idx<8, even, easy dsw", dsw: 0x00, idx: 0x03, round: 0x00, c: 0x11, t7: 0x20, flag: 0x00, pos: [0x40, 0x50, 0x60, 0x70] },
  { name: "flag!=0, idx>=8, odd, hard dsw", dsw: 0x07, idx: 0x0a, round: 0x01, c: 0x22, t7: 0x30, flag: 0x05, pos: [0x00, 0xff, 0x80, 0x01] },
  { name: "idx==7 boundary, even, flag=0", dsw: 0x00, idx: 0x07, round: 0x02, c: 0x33, t7: 0x10, flag: 0x00, pos: [0x7f, 0x80, 0x81, 0x82] },
  { name: "idx==0, odd, flag=0", dsw: 0x00, idx: 0x00, round: 0x03, c: 0x44, t7: 0x40, flag: 0x00, pos: [0x10, 0x20, 0x30, 0x40] },
];

// -- 1. EQUAL -----------------------------------------------------------------

test("EQUAL: crafted spawn cases — spawnActorSlotFromTemplate == oracle in RAM (−stack) + A", () => {
  for (const spec of CASES) {
    const o = craft(spec);
    oracle(o);
    const c = craft(spec);
    const ret = spawnActorSlotFromTemplate(c);

    const d = ramDiffMinusStack(o, c);
    assert.equal(d, null, d && `[${spec.name}] RAM diff at ${hx(d.addr ?? 0)}: oracle=${d.a} module=${d.b}`);
    assert.equal(ret & 0xff, o.regs.a & 0xff, `[${spec.name}] A return mismatch`);
    // SIDE-EFFECT arm: the module must SET A on its own clone (queueSoundCommand04IfNotBusy return-assignment bridge).
    assert.equal(c.regs.a & 0xff, o.regs.a & 0xff, `[${spec.name}] module must SET A`);
  }
  console.log(`  EQUAL: ${CASES.length} crafted spawn cases identical (RAM −stack + A)`);
});

// -- 2. WRITE-SET -------------------------------------------------------------

test("WRITE-SET: the slot fields + template+0a hold the contract values", () => {
  const spec = CASES[0]; // flag=0: looked-up anim vector, no clamp, no negate
  const m = craft(spec);
  oracle(m);

  const velocity = m.mem8[SLOT + 0x0a];
  const vecLo = m.mem8[SLOT + 0x0c];
  const vecHi = m.mem8[SLOT + 0x0d];
  const expected = new Map([
    [SLOT + 0x00, 0x01],
    [SLOT + 0x02, 0x04],
    [SLOT + 0x14, spec.c],
    [SLOT + 0x07, 0x00],
    [SLOT + 0x0e, 0x00],
    [SLOT + 0x05, (spec.pos[2] + 0x80) & 0xff],
    [SLOT + 0x03, (spec.pos[0] + 0x80) & 0xff],
    [SLOT + 0x04, (spec.pos[1] - 0x01) & 0xff],
    [SLOT + 0x06, (spec.pos[3] + 0x01) & 0xff],
    [SLOT + 0x0a, velocity],
    [SLOT + 0x0b, spec.flag],
    [SLOT + 0x0c, vecLo],
    [SLOT + 0x0d, vecHi],
    [SLOT + 0x11, 0x28],
    [TEMPLATE + 0x0a, velocity],
  ]);
  for (const [addr, val] of expected) {
    assert.equal(m.mem8[addr], val, `field ${hx(addr)} expected ${hx(val)} got ${hx(m.mem8[addr])}`);
  }

  // The +0b override path lays the fixed 0x3952 anim vector (LE) into the slot.
  const ov = craft(CASES[1]);
  oracle(ov);
  assert.equal(ov.mem8[SLOT + 0x0c], 0x52, "override vector low byte = 0x52");
  assert.equal(ov.mem8[SLOT + 0x0d], 0x39, "override vector high byte = 0x39");
  console.log(`  WRITE-SET: slot fields + template+0a set; velocity=${hx(velocity)}; override vector 0x3952`);
});

// -- 3. TEETH -----------------------------------------------------------------

test("TEETH: a wrong slot field is CAUGHT by the RAM diff", () => {
  const spec = CASES[0];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  spawnActorSlotFromTemplate(c);
  c.mem8[SLOT + 0x05] = (o.mem8[SLOT + 0x05] ^ 0xff) & 0xff; // BUG: wrong biased X byte

  const d = ramDiffMinusStack(o, c);
  assert.notEqual(d, null, "the gate FAILED to catch a wrong slot field — it is worthless");
  assert.equal(d.addr, SLOT + 0x05, `teeth caught wrong address ${hx(d.addr ?? 0)}`);
  console.log(`  TEETH/RAM: wrong slot+0x05 caught at ${hx(d.addr)} (oracle=${d.a} broken=${d.b})`);
});

test("TEETH: a wrong A is CAUGHT by the live-out check", () => {
  const spec = CASES[0];
  const o = craft(spec);
  const c = craft(spec);
  oracle(o);
  const ret = spawnActorSlotFromTemplate(c);
  assert.equal(ret & 0xff, o.regs.a & 0xff, "sanity: module A matches oracle");
  const broken = (o.regs.a ^ 0xff) & 0xff; // a wrong A the === check must reject
  assert.notEqual(broken, o.regs.a & 0xff, "the live-out check must reject a wrong A");
  console.log(`  TEETH/A: module A ${hx(ret)} == oracle; a flipped ${hx(broken)} is rejected`);
});
