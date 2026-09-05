// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_07e8 (ROM 0x07e8-0x0817): if (0x421d)!=0 run inlined loc_080c; elif (0x4195)==0 tail loc_0722;
// else advance (0x400a), arm timer 0x4009<-0x82, and if (0x4006) bit0 set fire sound via 0x08f2. Primary path:
// 0x421d==0, 0x4195!=0, 0x4006 bit0=0 -> arm+ret nc. Contract 114 T, no calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_07e8 } from "../loc_07e8.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const popStub = (mm) => { mm.pop16(); };

test("loc_07e8: arm-timer path (0x421d=0, 0x4195!=0, bit0=0); 114 T, no calls, timer 0x82", () => {
  const m = mk({ 0x080c: popStub, 0x0722: popStub, 0x08f2: popStub });
  m.mem.write8(0x421d, 0x00); // -> jr nz not taken
  m.mem.write8(0x4195, 0x01); // -> jp z not taken
  m.mem.write8(0x400a, 0x05); // sub-state before advance
  m.mem.write8(0x4006, 0x00); // bit0 clear -> ret nc (no sound)
  m.push16(0x9999);
  loc_07e8(m);
  assert.equal(m.cycles, 114, "10+13+4+7+13+4+10+11+4+10+13+4+11");
  assert.deepEqual(m.calls, [], "no delegation, no sound on this path");
  assert.equal(m.mem.read8(0x400a), 0x06, "(0x400a) sub-state advanced");
  assert.equal(m.mem.read8(0x4009), 0x82, "0x4009 state timer armed");
  assert.equal(m.pc, 0x9999, "ret nc to caller");
});

test("loc_07e8: (0x421d)!=0 -> inlined loc_080c, (0x4195)!=0 -> (0x400a)++, (0x4009)<-0x50, ret", () => {
  const m = mk({ 0x0712: popStub });
  m.mem.write8(0x421d, 0x01); // jr nz taken -> inlined loc_080c
  m.mem.write8(0x4195, 0x01); // jp z,0x0712 NOT taken
  m.mem.write8(0x400a, 0x03);
  m.push16(0x9999);
  loc_07e8(m);
  assert.deepEqual(m.calls, [], "no tail to loc_0712 when (0x4195)!=0");
  assert.equal(m.mem.read8(0x400a), 0x04, "(0x400a) incremented (HL=0x400a held from entry)");
  assert.equal(m.mem.read8(0x4009), 0x50, "(0x4009) <- 0x50");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_07e8: (0x421d)!=0 -> inlined loc_080c, (0x4195)==0 -> tail jp z,0x0712", () => {
  const m = mk({ 0x0712: popStub });
  m.mem.write8(0x421d, 0x01); // jr nz taken -> inlined loc_080c
  m.mem.write8(0x4195, 0x00); // jp z,0x0712 taken
  m.push16(0x9999);
  loc_07e8(m);
  assert.deepEqual(m.calls, [0x0712], "(0x4195)==0 -> jp z,0x0712");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_07e8.js
//   find: mem.write8(regs.hl, 0x82);
//   repl: mem.write8(regs.hl, 0x00);
//   expect: FAIL (timer armed to 0 not 0x82; caught by the 0x4009 assert)
test("loc_07e8: the contract catches a wrong timer reload value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x400a; m.step(0x07eb, 10);
    regs.a = mem.read8(0x421d); m.step(0x07ee, 13);
    regs.and(regs.a); m.step(0x07f1, 7); // not taken
    regs.a = mem.read8(0x4195); m.step(0x07f5, 4); // and a; jp z not taken below
    regs.and(regs.a); m.step(0x07f8, 10);
    regs.incMem8(mem, regs.hl); m.step(0x07f9, 11);
    regs.l = regs.dec8(regs.l); m.step(0x07fa, 4);
    mem.write8(regs.hl, 0x00); m.step(0x07fc, 10); // MUTANT: wrong timer reload
    // remainder irrelevant to the assert
  };
  const m = mk({ 0x080c: popStub, 0x0722: popStub, 0x08f2: popStub });
  m.mem.write8(0x421d, 0x00);
  m.mem.write8(0x4195, 0x01);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4009), 0x82));
});
