// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_08bc (ROM 0x08bc-0x08e4): service the 0x4208 block.
//   Gate set (0x4208 bit0): (0x4209)-=4; if result < 0x12 raise flag (0x420b)=1; ret. [path A, 105 T]
//   Gate clear -> loc_08d3: (0x4209)=0xdc, then (0x420a)=(0x4202) if (0x4200) bit0 set else 0. [path C, 112 T]
// No m.call (all arms ret); contract = T-state total + RAM effects.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_08bc } from "../loc_08bc.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

function run(fn, cells = {}) {
  const m = mk();
  m.regs.sp = 0x4400; // stack in WRAM so the pushed return is observable
  for (const [a, v] of Object.entries(cells)) m.mem.write8(Number(a), v);
  m.push16(0x9999); // caller return for the routine's own ret
  fn(m);
  return m;
}

test("loc_08bc: gate set -> counter -= 4, threshold borrow raises flag; 105 T", () => {
  // 0x4208 bit0 set; (0x4209)=0x12 -> stored 0x0e; -0x12 threshold borrows -> ret nc NOT taken -> (0x420b)=1
  const m = run(loc_08bc, { 0x4208: 0x01, 0x4209: 0x12 });
  assert.equal(m.cycles, 105, "T-state total for the gate-set/borrow path");
  assert.equal(m.mem.read8(0x4209), 0x0e, "counter decremented by 4 and stored");
  assert.equal(m.mem.read8(0x420b), 0x01, "flag raised (counter below 0x12 threshold)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_08bc: gate clear -> loc_08d3 reset, (0x420a) from (0x4202); 112 T", () => {
  const m = run(loc_08bc, { 0x4208: 0x00, 0x4200: 0x01, 0x4202: 0x77 });
  assert.equal(m.cycles, 112, "T-state total for the gate-clear reset path");
  assert.equal(m.mem.read8(0x4209), 0xdc, "counter reset to 0xdc");
  assert.equal(m.mem.read8(0x420a), 0x77, "(0x420a) sourced from (0x4202) since (0x4200) bit0 set");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_08bc.js
//   find: regs.sub(0x0e);
//   repl: regs.sub(0x00);
//   expect: FAIL (0x0c-0x00-0x04=0x08 -> no borrow -> ret nc -> flag never set; caught by the 0x420b assert)
//   verified-anchor: count == 1 (the sole "regs.sub(0x0e)" in loc_08bc.js)
test("loc_08bc: the contract catches a wrong borrow constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4208; m.step(0x08bf, 10);
    regs.bit(0, mem.read8(regs.hl)); m.step(0x08c1, 12);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x08c2, 6);
    m.step(0x08c4, 7); // gate set -> jr z not taken
    regs.a = mem.read8(regs.hl); m.step(0x08c5, 7);
    regs.sub(0x04); m.step(0x08c7, 7);
    mem.write8(regs.hl, regs.a); m.step(0x08c8, 7);
    regs.sub(0x00); m.step(0x08ca, 7); // MUTANT: sub 0x00 instead of 0x0e
    regs.sub(0x04); m.step(0x08cc, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x08cd, 5);
    regs.a = 0x01; m.step(0x08cf, 7);
    mem.write8(0x420b, regs.a); m.step(0x08d2, 13);
    m.ret();
  };
  const m = mk();
  m.regs.sp = 0x4400;
  m.mem.write8(0x4208, 0x01); m.mem.write8(0x4209, 0x12);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x420b), 0x01));
});
