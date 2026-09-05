// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_20cd (Galaxian, ROM 0x20cd-0x20e0): paints a 3-cell VIDEORAM column from HL by
// DE stride ((HL)=A+1, +DE=0x25, +DE=0x20), then clears 0x40ab only when B bit 4 clear AND 0x4006==0.
// Contract: fall-through path = 111 T (both `ret nz` not taken), the three VRAM writes, 0x40ab=0, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_20cd } from "../loc_20cd.js";

const RET = 0x1234;

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; m.push16(RET); // caller return address for the final `ret`
  return m;
}

test("loc_20cd: fall-through paints 3 VRAM cells + clears 0x40ab; 111 T", () => {
  const m = mk();
  m.regs.a = 0x00; m.regs.hl = 0x5000; m.regs.de = 0x0020; m.regs.b = 0x00;
  m.mem.write8(0x4006, 0);
  loc_20cd(m);
  assert.equal(m.cycles, 111, "T-state total (fall-through, both ret nz not taken)");
  assert.equal(m.pc, RET, "final ret returns to caller");
  assert.equal(m.mem.read8(0x5000), 0x01, "(HL) = A+1");
  assert.equal(m.mem.read8(0x5020), 0x25, "(HL+DE) = 0x25");
  assert.equal(m.mem.read8(0x5040), 0x20, "(HL+2DE) = 0x20");
  assert.equal(m.mem.read8(0x40ab), 0x00, "0x40ab cleared");
});

test("loc_20cd: B bit 4 set -> early ret nz (72 T), 0x40ab untouched", () => {
  const m = mk();
  m.mem.write8(0x40ab, 0x99);
  m.regs.a = 0x00; m.regs.hl = 0x5000; m.regs.de = 0x0020; m.regs.b = 0x10;
  loc_20cd(m);
  assert.equal(m.cycles, 72, "ret nz taken at 0x20d7");
  assert.equal(m.mem.read8(0x40ab), 0x99, "flag left alone");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_20cd.js
//   find: mem.write8(regs.hl, 0x25);
//   repl: mem.write8(regs.hl, 0x24);
//   expect: FAIL (wrong tile -> caught by read8(0x5020) == 0x25)
//   verified-anchor: count == 1 (the sole 0x25 write)
test("loc_20cd: the contract catches a wrong tile code", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = regs.inc8(regs.a); m.step(0x20ce, 4);
    mem.write8(regs.hl, regs.a); m.step(0x20cf, 7);
    regs.addHl(regs.de); m.step(0x20d0, 11);
    mem.write8(regs.hl, 0x24); m.step(0x20d2, 10); // MUTANT: 0x24 not 0x25
    regs.addHl(regs.de); m.step(0x20d3, 11);
    mem.write8(regs.hl, 0x20); m.step(0x20d5, 10);
    regs.bit(4, regs.b); m.step(0x20d7, 8);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x20d8, 5);
    regs.a = mem.read8(0x4006); m.step(0x20db, 13);
    regs.and(regs.a); m.step(0x20dc, 4);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x20dd, 5);
    mem.write8(0x40ab, regs.a); m.step(0x20e0, 13);
    m.ret();
  };
  const m = mk();
  m.regs.a = 0x00; m.regs.hl = 0x5000; m.regs.de = 0x0020; m.regs.b = 0x00;
  mutant(m);
  assert.notEqual(m.mem.read8(0x5020), 0x25);
});
