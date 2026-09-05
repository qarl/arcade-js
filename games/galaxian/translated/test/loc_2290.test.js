// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2290 (ROM 0x2290-0x229b): DE = (0x400d)==0 ? 0x40a2 : 0x40a5; ret.
// Zero path: 38 T, DE=0x40a2. Non-zero path: 52 T, DE=0x40a5.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2290 } from "../loc_2290.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}

test("loc_2290: (0x400d)==0 -> DE=0x40a2; 38 T", () => {
  const m = mk();
  m.mem.write8(0x400d, 0x00);
  m.push16(0x9999);
  loc_2290(m);
  assert.equal(m.cycles, 38, "ret-z path T-total");
  assert.equal(m.regs.de, 0x40a2, "DE keeps the default pointer");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_2290: (0x400d)!=0 -> DE=0x40a5; 52 T", () => {
  const m = mk();
  m.mem.write8(0x400d, 0x01);
  m.push16(0x9999);
  loc_2290(m);
  assert.equal(m.cycles, 52, "non-zero path T-total");
  assert.equal(m.regs.de, 0x40a5, "DE takes the alternate pointer");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2290.js
//   find: regs.de = 0x40a5;   repl: (drop it)
//   expect: FAIL -- non-zero path would leave DE=0x40a2 (caught by the DE assert)
test("loc_2290: contract catches a dropped alternate pointer", () => {
  const m = mk();
  m.mem.write8(0x400d, 0x01);
  m.push16(0x9999);
  const { regs, mem } = m;
  regs.de = 0x40a2; m.step(0x2293, 10);
  regs.a = mem.read8(0x400d); m.step(0x2296, 13);
  regs.and(regs.a); m.step(0x2297, 4);
  m.step(0x2298, 5); // ret z not taken
  m.step(0x229b, 10); // MUTANT: dropped `ld de,0x40a5`
  m.ret();
  assert.throws(() => assert.equal(m.regs.de, 0x40a5));
});
