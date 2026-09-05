// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0646 (ROM 0x0646-0x0660): seed HL=0x4100, B=0x10, C=0x01, then unpack 16 packed mask
// bytes at (DE) into 128 one-byte-per-bit flags at 0x4100 (LSB-first). loc_064d/0653/065c inlined.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0646 } from "../loc_0646.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };

test("loc_0646: 16 all-zero source bytes -> 128 zero cells; 9085 T", () => {
  const m = mk();
  m.push16(0x9999);
  for (let i = 0; i < 16; i++) wr(m, 0x4300 + i, 0x00);
  m.regs.de = 0x4300;
  loc_0646(m);
  const cells = Array.from({ length: 128 }, (_, i) => m.mem.workRam[(0x4100 + i) & 0x3ff]);
  assert.ok(cells.every((v) => v === 0), "all bits clear -> all 128 cells 0");
  assert.equal(m.regs.hl, 0x4180, "HL advanced 128 cells");
  assert.equal(m.regs.de, 0x4310, "DE advanced 16 source bytes");
  assert.equal(m.regs.b, 0x00, "djnz drained B");
  assert.equal(m.cycles, 9085, "24 setup + 16-byte unpack loop + ret");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0646: LSB-first unpack of first byte 0x05 -> cells[0..7]=[1,0,1,0,0,0,0,0]", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4300, 0x05); // bits 0 and 2 set
  for (let i = 1; i < 16; i++) wr(m, 0x4300 + i, 0x00);
  m.regs.de = 0x4300;
  loc_0646(m);
  const cells = Array.from({ length: 8 }, (_, i) => m.mem.workRam[(0x4100 + i) & 0x3ff]);
  assert.deepEqual(cells, [1, 0, 1, 0, 0, 0, 0, 0], "cell[i] = bit i of the first source byte");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0646.js
//   find: mem.write8(regs.hl, 0x01);   (the bit-set arm)
//   repl: mem.write8(regs.hl, 0x00);   (bit-set cell wrongly written 0)
//   expect: FAIL (cells for 0x05 become all 0 instead of [1,0,1,...]; caught by the LSB deepEqual)
test("loc_0646: the contract catches a bit-set cell written as 0", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4100; m.step(0x0649, 10);
    regs.b = 0x10; m.step(0x064b, 7);
    regs.c = 0x01; m.step(0x064d, 7);
    for (;;) {
      regs.a = mem.read8(regs.de); m.step(0x064e, 7);
      regs.and(regs.c); m.step(0x064f, 4);
      if (regs.fZ) {
        m.step(0x065c, 12); mem.write8(regs.hl, 0x00); m.step(0x065e, 10); m.step(0x0653, 10);
      } else {
        m.step(0x0651, 7); mem.write8(regs.hl, 0x00); m.step(0x0653, 10); // MUTANT: was 0x01
      }
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x0654, 6);
      regs.c = regs.rlc(regs.c); m.step(0x0656, 8);
      if (regs.fNC) { m.step(0x064d, 12); continue; }
      m.step(0x0658, 7);
      regs.de = (regs.de + 1) & 0xffff; m.step(0x0659, 6);
      if (regs.djnz() !== 0) { m.step(0x064d, 13); continue; }
      m.step(0x065b, 8); break;
    }
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4300, 0x05);
  for (let i = 1; i < 16; i++) wr(m, 0x4300 + i, 0x00);
  m.regs.de = 0x4300;
  mutant(m);
  const cells = Array.from({ length: 8 }, (_, i) => m.mem.workRam[(0x4100 + i) & 0x3ff]);
  assert.throws(() => assert.deepEqual(cells, [1, 0, 1, 0, 0, 0, 0, 0]));
});
