// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_10d8 (ROM 0x10d8-0x10e3): read field +0x04; ret c when (field-0xc8) < 5, else
// inc field +0x04. Contract on the fall-through path: 71 T (19+7+7+5+23+10), (ix+0x04) bumped, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_10d8 } from "../loc_10d8.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  return m;
}

test("loc_10d8: (field-0xc8) >= 5 bumps field +0x04; 71 T", () => {
  const m = mk();
  m.mem.write8(0x4204, 0xd0); // 0xd0-0xc8 = 8 >= 5 -> no carry -> inc path
  m.push16(0x9999);
  loc_10d8(m);
  assert.equal(m.cycles, 71, "sum of instr T-states on the inc path");
  assert.equal(m.mem.read8(0x4204), 0xd1, "inc (ix+0x04)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_10d8: (field-0xc8) < 5 returns without touching the field; 44 T", () => {
  const m = mk();
  m.mem.write8(0x4204, 0xca); // 0xca-0xc8 = 2 < 5 -> carry -> ret c
  m.push16(0x9999);
  loc_10d8(m);
  assert.equal(m.cycles, 44, "19+7+7+11 on the ret-c path");
  assert.equal(m.mem.read8(0x4204), 0xca, "field untouched");
  assert.equal(m.pc, 0x9999, "ret c to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_10d8.js
//   find: regs.incMem8(mem, (regs.ix + 0x04) & 0xffff);
//   repl: (drop it -- field never advances)
//   expect: FAIL (0x4204 stays 0xd0; caught by the inc assert)
test("loc_10d8: the contract catches a dropped inc", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff); m.step(0x10db, 19);
    regs.sub(0xc8); m.step(0x10dd, 7);
    regs.cp(0x05); m.step(0x10df, 7);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x10e0, 5);
    m.step(0x10e3, 23); // MUTANT: dropped inc (ix+0x04)
    m.ret();
  };
  const m = mk();
  m.mem.write8(0x4204, 0xd0);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4204), 0xd1));
});
