// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_15f4 (ROM 0x15f4-0x161a): scan 4 word-slots at 0x41e8 for first byte with bit0 set,
// write (E=slot,D=base) to 0x4213. Contract path: (0x421b)=0 seed (D=0x84,E=1), first byte @0x41e8 bit0 set
// -> immediate store DE=0x8401; 109 T, no calls, (0x4213)=0x8401.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_15f4 } from "../loc_15f4.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_15f4: (0x421b)=0, first slot bit0 set -> (0x4213)=0x8401; 109 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x421b, 0x00); // -> seed D=0x84, E=1
  m.mem.write8(0x41e8, 0x01); // first byte bit0 set -> immediate hit
  loc_15f4(m);
  assert.equal(m.cycles, 109, "10+7+13+4+7(nz not taken)+7+7+12+12+20+10");
  assert.deepEqual(m.calls, [], "no sub-calls");
  assert.equal(m.mem.read16(0x4213), 0x8401, "(0x4213) <- DE (D=0x84 high, E=1 low)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_15f4: (0x421b)!=0 -> alt seed D=0x9d/E=2", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x421b, 0x01); // -> loc_1615 seed D=0x9d, E=2
  m.mem.write8(0x41e8, 0x01); // first byte bit0 set
  loc_15f4(m);
  assert.equal(m.mem.read16(0x4213), 0x9d02, "(0x4213) <- 0x9d02 for the alt base");
});

test("loc_15f4: no bit set in any slot -> E walks to 5 (4 slots), D unchanged", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x421b, 0x00);
  for (let i = 0; i < 8; i++) m.mem.write8(0x41e8 + i, 0x00); // all clear
  loc_15f4(m);
  // 4 djnz iterations, E incremented once per iteration from 1 -> 5, base D=0x84
  assert.equal(m.mem.read16(0x4213), 0x8405, "E advanced to 5 after scanning all 4 slots");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_15f4.js
//   find: regs.d = 0x84;   (the (0x421b)==0 seed)
//   repl: regs.d = 0x00;
//   expect: FAIL (stored high byte wrong; caught by the (0x4213)=0x8401 assert)
test("loc_15f4: contract catches a wrong D seed", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x41e8; m.step(0x15f7, 10);
    regs.b = 0x04; m.step(0x15f9, 7);
    regs.a = mem.read8(0x421b); m.step(0x15fc, 13);
    regs.and(regs.a); m.step(0x15fd, 4);
    m.step(0x15ff, 7);
    regs.e = 0x01; m.step(0x1601, 7);
    regs.d = 0x00; m.step(0x1603, 7); // MUTANT: wrong D seed
    regs.bit(0, mem.read8(regs.hl)); m.step(0x1605, 12);
    m.step(0x1610, 12); // hit
    mem.write16(0x4213, regs.de); m.step(0x1614, 20);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x421b, 0x00); m.mem.write8(0x41e8, 0x01);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read16(0x4213), 0x8401));
});
