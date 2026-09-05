// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_20e1 (Galaxian, ROM 0x20e1-0x2103): maps coordinate byte A to VIDEORAM address
// HL = 0x5000 + offset from A's nibble fields; push af/pop af carries the post-rra A+carry out past the
// address math. Contract: straight line, 159 T. A=0x35 -> HL=0x514a, A restored to 0x01.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_20e1 } from "../loc_20e1.js";

const RET = 0x1234;

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; m.push16(RET);
  return m;
}

test("loc_20e1: A=0x35 -> HL=0x514a, A preserved via push/pop af; 159 T", () => {
  const m = mk();
  m.regs.a = 0x35; m.regs.f = 0x00;
  loc_20e1(m);
  assert.equal(m.cycles, 159, "T-state total (straight line)");
  assert.equal(m.pc, RET, "final ret returns to caller");
  assert.equal(m.regs.hl, 0x514a, "computed VIDEORAM cell address");
  assert.equal(m.regs.a, 0x01, "A = the post-rra value carried past the math");
});

test("loc_20e1: A=0x00 -> HL=0x500f (base + low-nibble fold)", () => {
  const m = mk();
  m.regs.a = 0x00; m.regs.f = 0x00;
  loc_20e1(m);
  assert.equal(m.regs.hl, 0x500f);
  assert.equal(m.regs.a, 0x00);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_20e1.js
//   find: regs.de = 0x5000; // VIDEORAM base
//   repl: regs.de = 0x4000; // VIDEORAM base
//   expect: FAIL (wrong base -> HL = 0x414a, caught by hl == 0x514a)
//   verified-anchor: count == 1 (the sole `regs.de = 0x5000`)
test("loc_20e1: the contract catches a wrong VIDEORAM base", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.b = regs.a; m.step(0x20e2, 4);
    regs.and(0x0f); m.step(0x20e4, 7);
    regs.rrca(); m.step(0x20e5, 4);
    regs.rrca(); m.step(0x20e6, 4);
    regs.c = regs.a; m.step(0x20e7, 4);
    regs.and(0x03); m.step(0x20e9, 7);
    regs.h = regs.a; m.step(0x20ea, 4);
    regs.a = regs.c; m.step(0x20eb, 4);
    regs.and(0xc0); m.step(0x20ed, 7);
    regs.l = regs.a; m.step(0x20ee, 4);
    regs.a = regs.b; m.step(0x20ef, 4);
    regs.rrca(); m.step(0x20f0, 4);
    regs.rrca(); m.step(0x20f1, 4);
    regs.rrca(); m.step(0x20f2, 4);
    regs.rrca(); m.step(0x20f3, 4);
    regs.and(0x07); m.step(0x20f5, 7);
    regs.c = regs.a; m.step(0x20f6, 4);
    regs.rra(); m.step(0x20f7, 4);
    m.push16(regs.af); m.step(0x20f8, 11);
    regs.adc(regs.c); m.step(0x20f9, 4);
    regs.cpl(); m.step(0x20fa, 4);
    regs.and(0x0f); m.step(0x20fc, 7);
    regs.add(regs.l); m.step(0x20fd, 4);
    regs.l = regs.a; m.step(0x20fe, 4);
    regs.de = 0x4000; m.step(0x2101, 10); // MUTANT: wrong base
    regs.addHl(regs.de); m.step(0x2102, 11);
    regs.af = m.pop16(); m.step(0x2103, 10);
    m.ret();
  };
  const m = mk();
  m.regs.a = 0x35; m.regs.f = 0x00;
  mutant(m);
  assert.notEqual(m.regs.hl, 0x514a);
});
