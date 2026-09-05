// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_01c6 (ROM 0x01c6-0x01e0): rst-0x10 clears 0x80 bytes at 0x4100, clears
// (0x425f)+(0x4224), seeds (0x400b)=0x5002, (0x4009)=0x20, bumps (0x400a); ret. Contract: 129 T, calls
// [0x0010]. The rst-0x10 stub does the real fill so the cleared region is checkable.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_01c6 } from "../loc_01c6.js";

// rst 0x10 = loc_0010 block-fill: (HL)<-A, HL++, B times (B=0 means 256), then pop the pushed return.
const rst10 = (mm) => {
  const r = mm.regs;
  do { mm.mem.write8(r.hl, r.a); r.hl = (r.hl + 1) & 0xffff; r.b = (r.b - 1) & 0xff; } while (r.b !== 0);
  mm.pop16();
};

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.routines.set(0x0010, rst10);
  return m;
}

test("loc_01c6: clear 0x4100 block + seed pointers/counter; 129 T", () => {
  const m = mk();
  m.mem.write8(0x4100, 0xaa); m.mem.write8(0x417f, 0xbb); // pre-dirty the fill window
  m.mem.write8(0x400a, 0x07);
  m.push16(0x9999);
  loc_01c6(m);
  assert.equal(m.cycles, 129, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x0010], "one rst-0x10 block-fill");
  assert.equal(m.mem.read8(0x4100), 0x00, "fill window cleared (low)");
  assert.equal(m.mem.read8(0x417f), 0x00, "fill window cleared (high, 0x80 bytes)");
  assert.equal(m.mem.read8(0x425f), 0x00);
  assert.equal(m.mem.read8(0x4224), 0x00);
  assert.equal(m.mem.read16(0x400b), 0x5002, "(0x400b) VIDEORAM pointer word");
  assert.equal(m.mem.read8(0x4009), 0x20, "(0x4009) counter");
  assert.equal(m.mem.read8(0x400a), 0x08, "(0x400a) bumped 0x07 -> 0x08");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_01c6.js
//   find: mem.write8(regs.hl, 0x20);
//   repl: mem.write8(regs.hl, 0x21);
//   expect: FAIL ((0x4009) counter wrong)
test("loc_01c6: the contract catches a wrong (0x4009) counter", () => {
  const m = mk();
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.hl = 0x4100; mm.step(0x01c9, 10);
    regs.b = 0x80; mm.step(0x01cb, 7);
    regs.xor(regs.a); mm.step(0x01cc, 4);
    mm.push16(0x01cd); mm.step(0x0010, 11); mm.call(0x0010);
    mem.write8(0x425f, regs.a); mm.step(0x01d0, 13);
    mem.write8(0x4224, regs.a); mm.step(0x01d3, 13);
    regs.hl = 0x5002; mm.step(0x01d6, 10);
    mem.write16(0x400b, regs.hl); mm.step(0x01d9, 16);
    regs.hl = 0x4009; mm.step(0x01dc, 10);
    mem.write8(regs.hl, 0x21); mm.step(0x01de, 10); // MUTANT
    regs.l = regs.inc8(regs.l); mm.step(0x01df, 4);
    regs.incMem8(mem, regs.hl); mm.step(0x01e0, 11);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4009), 0x20));
});
