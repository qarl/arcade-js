// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2187 (ROM 0x2187-0x219a): blank a 4x4 VRAM block, write 0x40 to four rows of four
// cells from 0x51da stepping +0x1c per row. Contract: 612 T, 16 cells = 0x40, gaps untouched.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2187 } from "../loc_2187.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(0x9999);
  return m;
}
const ROWS = [0x51da, 0x51fa, 0x521a, 0x523a];

test("loc_2187: blanks four rows of four VRAM cells; 612 T", () => {
  const m = mk();
  loc_2187(m);
  assert.equal(m.cycles, 612, "27 prologue + 3*145 + 140 + 10 ret");
  for (const base of ROWS) {
    for (let i = 0; i < 4; i++) assert.equal(m.mem.read8(base + i), 0x40, `cell 0x${(base + i).toString(16)}`);
  }
  assert.equal(m.mem.read8(0x51de), 0x00, "gap between rows untouched");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2187.js
//   find: mem.write8(regs.hl, 0x40);
//   repl: mem.write8(regs.hl, 0x00);
//   expect: FAIL (cells hold 0x00, caught by the ==0x40 assert)
test("loc_2187: the contract catches a wrong fill byte", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x51da; m.step(0x218a, 10);
    regs.de = 0x001c; m.step(0x218d, 10);
    regs.c = 0x04; m.step(0x218f, 7);
    for (;;) {
      regs.b = 0x04; m.step(0x2191, 7);
      for (;;) {
        mem.write8(regs.hl, 0x00); m.step(0x2193, 10); // MUTANT
        regs.hl = (regs.hl + 1) & 0xffff; m.step(0x2194, 6);
        if (regs.djnz() !== 0) { m.step(0x2191, 13); continue; }
        m.step(0x2196, 8); break;
      }
      regs.addHl(regs.de); m.step(0x2197, 11);
      regs.c = regs.dec8(regs.c); m.step(0x2198, 4);
      if (regs.fNZ) { m.step(0x218f, 12); continue; }
      m.step(0x219a, 7); break;
    }
    m.ret();
  };
  const m = mk();
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x51da), 0x40));
});
