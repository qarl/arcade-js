// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0020 (RST 20 vector, ROM 0x0020-0x0027): HL += A (16-bit), A = (HL).
//   0020  85        add a,l
//   0021  6f        ld l,a
//   0022  3e 00     ld a,0x00
//   0024  8c        adc a,h
//   0025  67        ld h,a
//   0026  7e        ld a,(hl)
//   0027  c9        ret
// Contract: 40 T (4+4+7+4+4+7+10). Uses HL=0x41FE, A=0x03 to exercise the carry propagate:
// 0xFE+0x03=0x101 -> L=0x01, carry into H -> H=0x42, HL=0x4201, A=(0x4201).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0020 } from "../loc_0020.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

function run(fn) {
  const m = mk();
  m.regs.a = 0x03;
  m.regs.hl = 0x41fe;
  m.regs.sp = 0x4300;
  m.mem.write8(0x4300, 0x00); m.mem.write8(0x4301, 0x20); // ret -> 0x2000
  m.mem.write8(0x4201, 0x77); // table entry at base+index
  fn(m);
  return { cycles: m.cycles, a: m.regs.a, hl: m.regs.hl, pc: m.pc };
}

function checkSpec(r) {
  assert.equal(r.cycles, 40, "4+4+7+4+4+7+10");
  assert.equal(r.hl, 0x4201, "HL = base + index, carry propagated into H");
  assert.equal(r.a, 0x77, "A = (HL) fetched entry");
  assert.equal(r.pc, 0x2000, "ret to caller");
}

test("loc_0020: indexed table fetch with carry propagate (40 T)", () => {
  checkSpec(run(loc_0020));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0020.js
//   find: regs.adc(regs.h);
//   repl: regs.add(regs.h);   (drops the carry from add a,l -> high byte wrong)
//   expect: FAIL  (H=0x41 not 0x42 -> HL=0x4101 -> reads the wrong cell)
//   verified-anchor: count == 1  (the sole adc in loc_0020.js)
test("loc_0020: the contract catches adc downgraded to add (lost carry)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.add(regs.l);
    m.step(0x0021, 4);
    regs.l = regs.a;
    m.step(0x0022, 4);
    regs.a = 0x00;
    m.step(0x0024, 7);
    regs.add(regs.h); // MUTANT: add instead of adc (loses carry)
    m.step(0x0025, 4);
    regs.h = regs.a;
    m.step(0x0026, 4);
    regs.a = mem.read8(regs.hl);
    m.step(0x0027, 7);
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
