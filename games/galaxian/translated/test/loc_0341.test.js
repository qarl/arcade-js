// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0341 (ROM 0x0341-0x0362): init a descriptor slot from (HL), using the ALT bank.
//   0341 7e / 0342 d9 / 0343 3d   A=(HL); exx; A=index (number-1)
//   0344 47 / 0345-47 0f x3       B=index; A=rotate-right-3(index)
//   0348-034e ... 19              E=A; D=0; HL=0x4330; HL+=DE  -> slot base
//   034f-0361                     [0]=1,[1]=0,[2]=0x0d,[4]=0,[5]=0x0c,[7]=index; exx; ret
// Contract: 162 T (straight line), main HL preserved across the two exx.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0341 } from "../loc_0341.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x43f0;
  m.mem.write8(0x43f0, 0x00); m.mem.write8(0x43f1, 0x20); // caller return = 0x2000
  return m;
}

// (HL)=2 -> index=1 -> rrca-x3(1)=0x20 -> base=0x4330+0x20=0x4350
function checkSlot(m) {
  assert.equal(m.cycles, 162, "T total");
  assert.equal(m.mem.read8(0x4350), 0x01, "[0]=1");
  assert.equal(m.mem.read8(0x4351), 0x00, "[1]=0");
  assert.equal(m.mem.read8(0x4352), 0x0d, "[2]=0x0d");
  assert.equal(m.mem.read8(0x4354), 0x00, "[4]=0");
  assert.equal(m.mem.read8(0x4355), 0x0c, "[5]=0x0c");
  assert.equal(m.mem.read8(0x4357), 0x01, "[7]=index (A-1)");
  assert.equal(m.regs.hl, 0x4200, "main HL preserved across exx/exx");
  assert.equal(m.pc, 0x2000, "ret");
}

test("loc_0341: builds descriptor slot at 0x4350 for (HL)=2; 162 T", () => {
  const m = mk();
  m.regs.hl = 0x4200;
  m.mem.write8(0x4200, 0x02); // descriptor number 2 -> index 1
  loc_0341(m);
  checkSlot(m);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0341.js
//   find: mem.write8(regs.hl, 0x0d);
//   repl: mem.write8(regs.hl, 0x0e);
//   expect: FAIL ([2] gets 0x0e instead of 0x0d)
test("loc_0341: the contract catches a wrong field-2 constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(regs.hl); m.step(0x0342, 7);
    regs.exx(); m.step(0x0343, 4);
    regs.a = regs.dec8(regs.a); m.step(0x0344, 4);
    regs.b = regs.a; m.step(0x0345, 4);
    regs.rrca(); m.step(0x0346, 4);
    regs.rrca(); m.step(0x0347, 4);
    regs.rrca(); m.step(0x0348, 4);
    regs.e = regs.a; m.step(0x0349, 4);
    regs.d = 0x00; m.step(0x034b, 7);
    regs.hl = 0x4330; m.step(0x034e, 10);
    regs.addHl(regs.de); m.step(0x034f, 11);
    mem.write8(regs.hl, 0x01); m.step(0x0351, 10);
    regs.l = regs.inc8(regs.l); m.step(0x0352, 4);
    mem.write8(regs.hl, 0x00); m.step(0x0354, 10);
    regs.l = regs.inc8(regs.l); m.step(0x0355, 4);
    mem.write8(regs.hl, 0x0e); m.step(0x0357, 10); // MUTANT
    regs.l = regs.inc8(regs.l); m.step(0x0358, 4);
    regs.l = regs.inc8(regs.l); m.step(0x0359, 4);
    mem.write8(regs.hl, 0x00); m.step(0x035b, 10);
    regs.l = regs.inc8(regs.l); m.step(0x035c, 4);
    mem.write8(regs.hl, 0x0c); m.step(0x035e, 10);
    regs.l = regs.inc8(regs.l); m.step(0x035f, 4);
    regs.l = regs.inc8(regs.l); m.step(0x0360, 4);
    mem.write8(regs.hl, regs.b); m.step(0x0361, 7);
    regs.exx(); m.step(0x0362, 4);
    m.ret();
  };
  const m = mk();
  m.regs.hl = 0x4200;
  m.mem.write8(0x4200, 0x02);
  mutant(m);
  assert.throws(() => checkSlot(m));
});
