// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2279 (ROM 0x2279-0x228f): BCD-nibble -> VRAM tile (digit+0x90) with C-gated leading-
// zero blanking; store at (IX), IX+=DE, ret. Non-zero path: 84 T, tile=digit+0x90, C cleared, IX+=DE.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2279 } from "../loc_2279.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}

test("loc_2279: non-zero digit -> tile digit+0x90, C=0, IX+=DE; 84 T", () => {
  const m = mk();
  m.regs.a = 0x35;   // nibble 5 (high bits prove the 0x0f mask)
  m.regs.c = 0x07;   // some blanking state -- cleared by a non-zero digit
  m.regs.ix = 0x4300;
  m.regs.de = 0x0001;
  m.push16(0x9999);
  loc_2279(m);
  assert.equal(m.cycles, 84, "non-zero-digit path T-total");
  assert.equal(m.mem.read8(0x4300), 0x95, "tile = 5 + 0x90 = '5'");
  assert.equal(m.regs.c, 0x00, "C cleared on a non-zero digit");
  assert.equal(m.regs.ix, 0x4301, "IX advanced by DE");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_2279: zero digit while blanking -> tile 0x10 (blank), C dec'd", () => {
  const m = mk();
  m.regs.a = 0x00;   // digit 0
  m.regs.c = 0x03;   // C!=0 -> blank the leading zero
  m.regs.ix = 0x4300;
  m.regs.de = 0x0001;
  m.push16(0x9999);
  loc_2279(m);
  assert.equal(m.mem.read8(0x4300), 0x10, "0x80+0x90 wraps to blank tile 0x10");
  assert.equal(m.regs.c, 0x02, "C decremented");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2279.js
//   find: regs.add(0x90);   repl: regs.add(0x80);
//   expect: FAIL -- tile would be 0x85 not 0x95 (caught by the mem assert)
test("loc_2279: contract catches a wrong tile base", () => {
  const m = mk();
  m.regs.a = 0x05; m.regs.c = 0x00; m.regs.ix = 0x4300; m.regs.de = 0x0001;
  m.push16(0x9999);
  const { regs, mem } = m;
  regs.and(0x0f); m.step(0x227b, 7);
  m.step(0x227d, 7); regs.c = 0x00; m.step(0x227f, 7); m.step(0x2288, 12);
  regs.add(0x80); m.step(0x228a, 7); // MUTANT: wrong base
  mem.write8((regs.ix + 0x00) & 0xffff, regs.a); m.step(0x228d, 19);
  regs.addIx(regs.de); m.step(0x228f, 15); m.ret();
  assert.throws(() => assert.equal(m.mem.read8(0x4300), 0x95));
});
