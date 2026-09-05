// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1060 (ROM 0x1060-0x108d): ascending path-walk variant (also the (0x4008) vector
// handler). Path: add the ROM step-table byte to Y (ix+0x04), advance the cursor, tick the throttle.
// Contract: 102 T, (ix+0x04) increased by table byte, cursor (ix+0x13) advanced, ret nz.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1060 } from "../loc_1060.js";

function mk(rom) {
  const m = new Machine(rom, new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  m.regs.hl = 0x1e20; // step-table pointer as loc_101f/vector leaves it
  return m;
}

test("loc_1060: ascending path adds Y delta, advances cursor, ret nz; 102 T", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x1e20] = 0x04; // Y delta
  const m = mk(rom);
  m.mem.write8(0x4204, 0x10); // (ix+0x04) Y
  m.mem.write8(0x4210, 0x05); // (ix+0x10) throttle
  m.push16(0x9999);
  loc_1060(m);
  assert.equal(m.mem.read8(0x4204), 0x14, "Y += table[0x1e20]");
  assert.equal(m.mem.read8(0x4213), 0x21, "cursor (ix+0x13) = L after inc");
  assert.equal(m.mem.read8(0x4210), 0x04, "throttle decremented, still nonzero");
  assert.equal(m.pc, 0x9999, "ret nz to caller");
  assert.equal(m.cycles, 102, "19+7+19+4+19+23+11");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1060.js
//   find (at 0x1063): regs.add(mem.read8(regs.hl));   repl: regs.sub(mem.read8(regs.hl));
//   expect: FAIL (Y becomes 0x0c instead of 0x14)
test("loc_1060: contract catches sub-vs-add on the Y delta", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x1e20] = 0x04;
  const m = mk(rom);
  m.mem.write8(0x4204, 0x10);
  m.mem.write8(0x4210, 0x05);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = mem.read8(regs.ix + 0x04); mm.step(0x1063, 19);
    regs.sub(mem.read8(regs.hl)); mm.step(0x1064, 7); // MUTANT: sub not add
    mem.write8(regs.ix + 0x04, regs.a); mm.step(0x1067, 19);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4204), 0x14));
});
