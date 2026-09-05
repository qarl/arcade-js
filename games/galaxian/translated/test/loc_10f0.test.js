// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_10f0 (ROM 0x10f0-0x1111): init fields +0x10/+0x11/+0x12, advance state (+0x02),
// then write (0x41df) = 0x07 (field +0x07 < 0x70) or 0x17 (>= 0x70, interior loc_110c).
// Contract on the < 0x70 path: 143 T, fields set, (0x41df)=0x07, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_10f0 } from "../loc_10f0.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  return m;
}

test("loc_10f0: field +0x07 < 0x70 writes (0x41df)=0x07; 143 T", () => {
  const m = mk();
  m.mem.write8(0x4207, 0x50); // < 0x70 -> jr nc not taken
  m.mem.write8(0x4202, 0x03); // state, to observe inc -> 0x04
  m.push16(0x9999);
  loc_10f0(m);
  assert.equal(m.cycles, 143, "T-states on the < 0x70 path");
  assert.equal(m.mem.read8(0x4210), 0x04, "(ix+0x10)=4");
  assert.equal(m.mem.read8(0x4211), 0x04, "(ix+0x11)=4");
  assert.equal(m.mem.read8(0x4212), 0x1c, "(ix+0x12)=0x1c");
  assert.equal(m.mem.read8(0x4202), 0x04, "inc (ix+0x02)");
  assert.equal(m.mem.read8(0x41df), 0x07, "(0x41df)=0x07");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_10f0: field +0x07 >= 0x70 writes (0x41df)=0x17 (loc_110c); 148 T", () => {
  const m = mk();
  m.mem.write8(0x4207, 0x70); // >= 0x70 -> jr nc taken
  m.push16(0x9999);
  loc_10f0(m);
  assert.equal(m.cycles, 148, "T-states on the >= 0x70 (loc_110c) path");
  assert.equal(m.mem.read8(0x41df), 0x17, "(0x41df)=0x17");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_10f0.js
//   find: regs.cp(0x70);
//   repl: regs.cp(0x40);  // wrong threshold
//   expect: FAIL (field 0x50 now >= 0x40 -> takes loc_110c, writes 0x17 not 0x07)
test("loc_10f0: the contract catches a wrong branch threshold", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8((regs.ix + 0x10) & 0xffff, 0x04); m.step(0x10f4, 19);
    mem.write8((regs.ix + 0x11) & 0xffff, 0x04); m.step(0x10f8, 19);
    mem.write8((regs.ix + 0x12) & 0xffff, 0x1c); m.step(0x10fc, 19);
    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); m.step(0x10ff, 23);
    regs.a = mem.read8((regs.ix + 0x07) & 0xffff); m.step(0x1102, 19);
    regs.cp(0x40); m.step(0x1104, 7); // MUTANT: threshold 0x40
    if (regs.fNC) {
      m.step(0x110c, 12);
      regs.a = 0x17; m.step(0x110e, 7);
      mem.write8(0x41df, regs.a); m.step(0x1111, 13);
      m.ret(); return;
    }
    m.step(0x1106, 7);
    regs.a = 0x07; m.step(0x1108, 7);
    mem.write8(0x41df, regs.a); m.step(0x110b, 13);
    m.ret();
  };
  const m = mk();
  m.mem.write8(0x4207, 0x50);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x41df), 0x07));
});
