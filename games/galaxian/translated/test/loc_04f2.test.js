// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_04f2 (ROM 0x04f2-0x050e): entered from loc_0492 when (0x4011) bit0 set.
// z-arm ((0x4002)==0): (0x4005)<-1, ret; 59 T. else-arm: dec (0x4002), rst-0x10 fill, jp loc_04bc; 93 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_04f2 } from "../loc_04f2.js";

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
const rst10 = (mm) => { mm.pop16(); };       // loc_0010 block-fill stub: pop its return addr
const stub04bc = (mm) => { mm.pop16(); };    // loc_04bc delegate stub

test("loc_04f2: z-arm (0x4002==0) sets (0x4005)=1 and rets; 59 T", () => {
  const m = mk({});
  m.mem.write8(0x4002, 0x00);
  m.push16(0x9999);
  loc_04f2(m);
  assert.equal(m.cycles, 59, "13+4+12+7+13+10");
  assert.equal(m.mem.read8(0x4005), 0x01, "(0x4005) <- 1");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.deepEqual(m.calls, [], "z-arm makes no calls");
});

test("loc_04f2: else-arm decrements (0x4002), block-fills, jp loc_04bc; 93 T", () => {
  const m = mk({ 0x0010: rst10, 0x04bc: stub04bc });
  m.mem.write8(0x4002, 0x05);
  m.push16(0x9999);
  loc_04f2(m);
  assert.equal(m.cycles, 93, "sum of loc_04f2's own instr T-states (fill stubbed)");
  assert.equal(m.mem.read8(0x4002), 0x04, "dec (0x4002): 5 -> 4");
  assert.deepEqual(m.calls, [0x0010, 0x04bc], "rst 0x10 fill then delegate to loc_04bc");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_04f2.js
//   find: regs.a = regs.dec8(regs.a);
//   repl: (drop it -- (0x4002) keeps its old value)
//   expect: FAIL ((0x4002) stays 5; caught by the dec assert)
test("loc_04f2: the contract catches a dropped `dec a`", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4002); m.step(0x04f5, 13);
    regs.and(regs.a); m.step(0x04f6, 4);
    m.step(0x04f8, 7); // (0x4002)=5 so z not taken
    m.step(0x04f9, 4); // MUTANT: dropped `dec a`
    mem.write8(0x4002, regs.a); m.step(0x04fc, 13);
    regs.hl = 0x41a0; m.step(0x04ff, 10);
    regs.b = 0x20; m.step(0x0501, 7);
    regs.xor(regs.a); m.step(0x0502, 4);
    m.push16(0x0503); m.step(0x0010, 11); m.call(0x0010);
    regs.hl = 0x0000; m.step(0x0506, 10);
    m.step(0x04bc, 10); return m.call(0x04bc);
  };
  const m = mk({ 0x0010: rst10, 0x04bc: stub04bc });
  m.mem.write8(0x4002, 0x05);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4002), 0x04));
});
