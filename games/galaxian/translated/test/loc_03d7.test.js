// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_03d7 (ROM 0x03d7-0x03f1): if (0x4002)!=0 bump (0x4005), zero (0x4007), clear
// (0x400a)/(0x41c2)/(0x41df)/(0x40b0); else early ret. Contract: 127 T (body) / 28 T (early), all work RAM.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_03d7 } from "../loc_03d7.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_03d7: (0x4002)!=0 bumps substate and clears state cells; 127 T", () => {
  const m = mk();
  wr(m, 0x4002, 0x01);
  wr(m, 0x4005, 0x05); wr(m, 0x4007, 0xff);
  wr(m, 0x400a, 0xff); wr(m, 0x41c2, 0xff); wr(m, 0x41df, 0xff); wr(m, 0x40b0, 0xff);
  m.push16(0x9999);
  loc_03d7(m);
  assert.equal(m.cycles, 127, "T-state total (body path)");
  assert.equal(rd(m, 0x4005), 0x06, "inc (0x4005) substate counter");
  assert.equal(rd(m, 0x4007), 0x00, "ld (0x4007),0");
  assert.equal(rd(m, 0x400a), 0x00, "game state cleared");
  assert.equal(rd(m, 0x41c2), 0x00, "flag 0x41c2 cleared");
  assert.equal(rd(m, 0x41df), 0x00, "flag 0x41df cleared");
  assert.equal(rd(m, 0x40b0), 0x00, "flag 0x40b0 cleared");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_03d7: (0x4002)==0 early ret, no writes; 28 T", () => {
  const m = mk();
  wr(m, 0x4002, 0x00);
  wr(m, 0x4005, 0x05);
  m.push16(0x9999);
  loc_03d7(m);
  assert.equal(m.cycles, 28, "T-state total (early ret: 13+4+11)");
  assert.equal(rd(m, 0x4005), 0x05, "0x4005 untouched on the early ret");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH: drop the two `inc l` so `ld (hl),0` lands on 0x4005 (already inc'd to 6) -> 0x4005 becomes 0.
test("loc_03d7: contract catches a dropped HL bump before the (hl)<-0 write", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4002); m.step(0x03da, 13);
    regs.and(regs.a); m.step(0x03db, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x03dc, 5);
    regs.hl = 0x4005; m.step(0x03df, 10);
    mem.write8(regs.hl, regs.inc8(mem.read8(regs.hl))); m.step(0x03e0, 11);
    m.step(0x03e1, 4); // MUTANT: dropped inc l
    m.step(0x03e2, 4); // MUTANT: dropped inc l
    mem.write8(regs.hl, 0x00); m.step(0x03e4, 10);
    regs.xor(regs.a); m.step(0x03e5, 4);
    mem.write8(0x400a, regs.a); m.step(0x03e8, 13);
    mem.write8(0x41c2, regs.a); m.step(0x03eb, 13);
    mem.write8(0x41df, regs.a); m.step(0x03ee, 13);
    mem.write8(0x40b0, regs.a); m.step(0x03f1, 13);
    m.ret();
  };
  const m = mk();
  wr(m, 0x4002, 0x01); wr(m, 0x4005, 0x05);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x4005), 0x06));
});
