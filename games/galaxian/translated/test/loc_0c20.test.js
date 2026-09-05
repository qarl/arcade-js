// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0c20 (ROM 0x0c20-0x0cc2): build a hardware sprite record at IY from object IX.
// Exercised path: (ix+0) active, angle (ix+5)=3 -> the 0<=A<6 arm (add 0x11, or 0xc0), inc X and Y; ret.
// Contract: 317 T, no m.calls, (iy+1)=0xd4, ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0c20 } from "../loc_0c20.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// IX = object slot, IY = 4-byte sprite record; seed the fields the exercised path reads.
function setup(m) {
  const { regs, mem } = m;
  regs.ix = 0x42b0;
  regs.iy = 0x4060;
  regs.c = 0x00;
  mem.write8(0x42b0 + 0x00, 0x01); // (ix+0) active
  mem.write8(0x42b0 + 0x03, 0x50); // X source
  mem.write8(0x42b0 + 0x04, 0x20); // Y source
  mem.write8(0x42b0 + 0x05, 0x03); // angle (0<=A<6 arm)
  mem.write8(0x42b0 + 0x0f, 0x00); // attr bias
  mem.write8(0x42b0 + 0x16, 0x0a); // sprite#
  m.push16(0x9999);
}

test("loc_0c20: active object, angle 3 -> attr 0xd4; sprite record filled; 317 T", () => {
  const m = mk();
  setup(m);
  loc_0c20(m);
  assert.equal(m.cycles, 317, "sum of all instr T-states on this path");
  assert.deepEqual(m.calls, [], "no calls -- straight-line to ret");
  assert.equal(m.mem.read8(0x4060 + 0x02), 0x0a, "(iy+2) = sprite#");
  assert.equal(m.mem.read8(0x4060 + 0x03), 0x49, "(iy+3) = X (0x50-8, then inc)");
  assert.equal(m.mem.read8(0x4060 + 0x00), 0xe0, "(iy+0) = Y (~0x20-0, then inc)");
  assert.equal(m.mem.read8(0x4060 + 0x01), 0xd4, "(iy+1) = attr (3+0x11 | 0xc0)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0c20.js  (the 0<=A<6 arm)
//   find: regs.or(0xc0);   repl: drop it
//   expect: FAIL -- (iy+1) becomes 0x14 not 0xd4; caught by the attr assert.
test("loc_0c20: the contract catches a dropped `or 0xc0` (wrong attr)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.bit(0, mem.read8((regs.ix + 0x00) & 0xffff)); m.step(0x0c24, 20);
    m.step(0x0c27, 10);
    regs.a = mem.read8((regs.ix + 0x16) & 0xffff); m.step(0x0c2a, 19);
    mem.write8((regs.iy + 0x02) & 0xffff, regs.a); m.step(0x0c2d, 19);
    regs.a = mem.read8((regs.ix + 0x03) & 0xffff); m.step(0x0c30, 19);
    regs.sub(0x08); m.step(0x0c32, 7);
    mem.write8((regs.iy + 0x03) & 0xffff, regs.a); m.step(0x0c35, 19);
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff); m.step(0x0c38, 19);
    regs.cpl(); m.step(0x0c39, 4);
    regs.sub(regs.c); m.step(0x0c3a, 4);
    mem.write8((regs.iy + 0x00) & 0xffff, regs.a); m.step(0x0c3d, 19);
    regs.a = mem.read8((regs.ix + 0x05) & 0xffff); m.step(0x0c40, 19);
    regs.and(regs.a); m.step(0x0c41, 4);
    m.step(0x0c58, 10);
    regs.cp(0x06); m.step(0x0c5a, 7);
    m.step(0x0c5d, 10);
    regs.add(0x11); m.step(0x0c5f, 7);
    m.step(0x0c61, 7); // MUTANT: dropped `or 0xc0`
    regs.add(mem.read8((regs.ix + 0x0f) & 0xffff)); m.step(0x0c64, 19);
    mem.write8((regs.iy + 0x01) & 0xffff, regs.a); m.step(0x0c67, 19);
    regs.incMem8(mem, (regs.iy + 0x03) & 0xffff); m.step(0x0c6a, 23);
    regs.incMem8(mem, (regs.iy + 0x00) & 0xffff); m.step(0x0c6d, 23);
    m.ret();
  };
  const m = mk();
  setup(m);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4060 + 0x01), 0xd4));
});
