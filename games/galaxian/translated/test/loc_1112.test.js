// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1112 (ROM 0x1112-0x113c): countdown +0x10; on 0 reload +0x10, inc +0x12, countdown
// +0x11; on 0 either clear +0x01 (field +0x07 < 0x70) or run interior loc_112d (>= 0x70): +0x10=0x32,
// +0x12=(0x422d)+0x20, advance state (+0x02). Contracts on the early-ret path and the loc_112d path.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1112 } from "../loc_1112.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  return m;
}

test("loc_1112: +0x10 not elapsed returns early; 34 T", () => {
  const m = mk();
  m.mem.write8(0x4210, 0x05); // dec -> 4, nonzero -> ret nz
  m.push16(0x9999);
  loc_1112(m);
  assert.equal(m.cycles, 34, "23 (dec) + 11 (ret nz taken)");
  assert.equal(m.mem.read8(0x4210), 0x04, "dec (ix+0x10)");
  assert.equal(m.pc, 0x9999, "early ret to caller");
});

test("loc_1112: +0x10 and +0x11 both elapse, +0x07 >= 0x70 runs loc_112d; 227 T", () => {
  const m = mk();
  m.mem.write8(0x4210, 0x01); // dec -> 0
  m.mem.write8(0x4211, 0x01); // dec -> 0
  m.mem.write8(0x4212, 0x05); // inc'd then overwritten by loc_112d
  m.mem.write8(0x4207, 0x70); // >= 0x70 -> loc_112d
  m.mem.write8(0x422d, 0x10); // +0x20 -> 0x30
  m.mem.write8(0x4202, 0x02); // state, to observe inc -> 0x03
  m.push16(0x9999);
  loc_1112(m);
  assert.equal(m.cycles, 227, "T-states on the loc_112d path");
  assert.equal(m.mem.read8(0x4210), 0x32, "(ix+0x10)=0x32 (loc_112d)");
  assert.equal(m.mem.read8(0x4211), 0x00, "(ix+0x11) counted to 0");
  assert.equal(m.mem.read8(0x4212), 0x30, "(ix+0x12)=(0x422d)+0x20");
  assert.equal(m.mem.read8(0x4202), 0x03, "inc (ix+0x02)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1112.js
//   find: regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);  (the loc_112d state advance)
//   repl: (drop it -- state never advances)
//   expect: FAIL ((ix+0x02) stays 0x02; caught by the inc assert)
test("loc_1112: the contract catches a dropped state advance in loc_112d", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.decMem8(mem, (regs.ix + 0x10) & 0xffff); m.step(0x1115, 23);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1116, 5);
    mem.write8((regs.ix + 0x10) & 0xffff, 0x04); m.step(0x111a, 19);
    regs.incMem8(mem, (regs.ix + 0x12) & 0xffff); m.step(0x111d, 23);
    regs.decMem8(mem, (regs.ix + 0x11) & 0xffff); m.step(0x1120, 23);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1121, 5);
    regs.a = mem.read8((regs.ix + 0x07) & 0xffff); m.step(0x1124, 19);
    regs.cp(0x70); m.step(0x1126, 7);
    if (regs.fNC) {
      m.step(0x112d, 12);
      mem.write8((regs.ix + 0x10) & 0xffff, 0x32); m.step(0x1131, 19);
      regs.a = mem.read8(0x422d); m.step(0x1134, 13);
      regs.add(0x20); m.step(0x1136, 7);
      mem.write8((regs.ix + 0x12) & 0xffff, regs.a); m.step(0x1139, 19);
      m.step(0x113c, 23); // MUTANT: dropped inc (ix+0x02)
      m.ret(); return;
    }
    m.step(0x1128, 7);
    mem.write8((regs.ix + 0x01) & 0xffff, 0x00); m.step(0x112c, 19);
    m.ret();
  };
  const m = mk();
  m.mem.write8(0x4210, 0x01);
  m.mem.write8(0x4211, 0x01);
  m.mem.write8(0x4207, 0x70);
  m.mem.write8(0x422d, 0x10);
  m.mem.write8(0x4202, 0x02);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4202), 0x03));
});
