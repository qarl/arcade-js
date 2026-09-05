// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1147 (ROM 0x1147-0x116a): from the packed cell (ix+0x07) compute
//   Y (ix+0x03) = 0x7c - 3/4*(cell&0x70), X (ix+0x04) = (0x420e) + ((cell&0x0f)<<4) + 7.
// Contract: 175 T; for cell=0x53, base(0x420e)=0x10 -> Y=0x40, X=0x47.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1147 } from "../loc_1147.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4280; // struct base clear of the 0x420e X-anchor
  return m;
}

test("loc_1147: derives sprite Y/X from the packed cell; 175 T", () => {
  const m = mk();
  m.mem.write8(0x4287, 0x53); // (ix+0x07) cell: row bits 0x50, col bits 0x03
  m.mem.write8(0x420e, 0x10); // X base/anchor
  m.push16(0x9999);
  loc_1147(m);
  assert.equal(m.mem.read8(0x4283), 0x40, "(ix+0x03) Y = 0x7c - 3/4*0x50 = 0x40");
  assert.equal(m.mem.read8(0x4284), 0x47, "(ix+0x04) X = 0x10 + (0x03<<4) + 7 = 0x47");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.cycles, 175, "sum of all instr T-states incl. ret");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1147.js
//   find: regs.add(0x7c);
//   repl: regs.add(0x7d);   // wrong Y offset
//   expect: FAIL (Y computes 0x41 instead of 0x40)
test("loc_1147: contract catches a wrong Y offset", () => {
  const m = mk();
  m.mem.write8(0x4287, 0x53);
  m.mem.write8(0x420e, 0x10);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = mem.read8(regs.ix + 0x07); mm.step(0x114a, 19);
    regs.and(0x70); mm.step(0x114c, 7);
    regs.rrca(); mm.step(0x114d, 4);
    regs.c = regs.a; mm.step(0x114e, 4);
    regs.rrca(); mm.step(0x114f, 4);
    regs.add(regs.c); mm.step(0x1150, 4);
    regs.neg(); mm.step(0x1152, 8);
    regs.add(0x7d); mm.step(0x1154, 7); // MUTANT: 0x7d not 0x7c
    mem.write8(regs.ix + 0x03, regs.a); mm.step(0x1157, 19);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4283), 0x40));
});
