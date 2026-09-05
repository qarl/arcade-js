// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_03c0 (ROM 0x03c0-0x03d6): blank B columns of VRAM with tile 0x10, 3 cells/column up
// -0x20/row, column advance L += 0x62; ret. Contract (B=2): 301 T, six 0x10 writes, HL ends 0x5197.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_03c0 } from "../loc_03c0.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_03c0: blank 2 columns (6 cells) with tile 0x10; 301 T", () => {
  const m = mk();
  m.regs.b = 0x02;
  m.push16(0x9999);
  loc_03c0(m);
  assert.equal(m.cycles, 301, "T-state total for B=2");
  assert.deepEqual(m.calls, [], "no calls");
  for (const a of [0x5193, 0x5173, 0x5153, 0x5195, 0x5175, 0x5155]) {
    assert.equal(m.mem.read8(a), 0x10, `blanked cell 0x${a.toString(16)}`);
  }
  assert.equal(m.regs.hl, 0x5197, "HL after 2 column advances");
  assert.equal(m.regs.b, 0x00, "djnz counted B to 0");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH: drop the column advance `add a,0x62` so pass 2 rewrites pass-1 cells; 0x5155 never gets 0x10.
test("loc_03c0: contract catches a dropped column advance", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x5193; m.step(0x03c3, 10);
    regs.de = 0xffe0; m.step(0x03c6, 10);
    for (;;) {
      regs.c = 0x03; m.step(0x03c8, 7);
      regs.a = 0x10; m.step(0x03ca, 7);
      for (;;) {
        mem.write8(regs.hl, regs.a); m.step(0x03cb, 7);
        regs.addHl(regs.de); m.step(0x03cc, 11);
        regs.c = regs.dec8(regs.c); m.step(0x03cd, 4);
        if (regs.fNZ) { m.step(0x03ca, 10); continue; }
        m.step(0x03d0, 10); break;
      }
      regs.a = regs.l; m.step(0x03d1, 4);
      m.step(0x03d3, 7); // MUTANT: dropped `add a,0x62`
      regs.l = regs.a; m.step(0x03d4, 4);
      if (regs.djnz() !== 0) { m.step(0x03c6, 13); continue; }
      m.step(0x03d6, 8); break;
    }
    m.ret();
  };
  const m = mk();
  m.regs.b = 0x02;
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x5155), 0x10));
});
