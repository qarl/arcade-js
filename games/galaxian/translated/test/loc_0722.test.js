// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0722 (ROM 0x0722-0x073c): if 0x4006 bit0 clear -> loc_070d; else state<-1, clear
// 0x4006/0x400a, silence sound (loc_1cb5), tail-jump loc_08f2 with DE=0x0600.
// Contract (bit0 set): 111 T, calls [0x1cb5,0x08f2], 0x4005=1, 0x4006=0, 0x400a=0, DE=0x0600.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0722 } from "../loc_0722.js";

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
const noop = () => {};
const rst = (mm) => { mm.pop16(); }; // loc_1cb5 rets cleanly

test("loc_0722: bit0 set -> full body, silence + enqueue; 111 T", () => {
  const m = mk({ 0x1cb5: rst, 0x08f2: noop });
  m.mem.write8(0x4006, 0x01); // bit0 set -> not-taken
  m.mem.write8(0x400a, 0x77); // proven cleared below
  loc_0722(m);
  assert.equal(m.cycles, 111, "sum of instr T-states (not-taken jr)");
  assert.deepEqual(m.calls, [0x1cb5, 0x08f2], "silence then tail-jump loc_08f2");
  assert.equal(m.mem.read8(0x4005), 0x01, "next-state select <- 1");
  assert.equal(m.mem.read8(0x4006), 0x00, "frame flag cleared");
  assert.equal(m.mem.read8(0x400a), 0x00, "0x400a cleared");
  assert.equal(m.regs.de, 0x0600, "DE=0x0600 handed to loc_08f2");
  assert.equal(m.pc, 0x08f2, "pc at loc_08f2");
});

test("loc_0722: bit0 clear -> jr nc loc_070d; 29 T", () => {
  const m = mk({ 0x070d: noop });
  m.mem.write8(0x4006, 0x00); // bit0 clear -> taken
  loc_0722(m);
  assert.equal(m.cycles, 29, "ld a 13 + rrca 4 + jr taken 12");
  assert.deepEqual(m.calls, [0x070d], "bail to loc_070d");
  assert.equal(m.pc, 0x070d, "pc at loc_070d");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0722.js
//   find: regs.rrca();
//   repl: (drop it)   // carry then reflects the reset F (C clear) regardless of 0x4006
//   expect: FAIL (with bit0 SET the branch is wrongly taken -> calls [0x070d], not [0x1cb5,0x08f2])
test("loc_0722: contract catches a dropped rrca (wrong branch)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4006); m.step(0x0725, 13);
    /* MUTANT: dropped rrca */
    if (regs.fNC) { m.step(0x070d, 12); return m.call(0x070d); }
    m.step(0x0728, 7);
    regs.a = 0x01; m.step(0x072a, 7);
    mem.write8(0x4005, regs.a); m.step(0x072d, 13);
    regs.xor(regs.a); m.step(0x072e, 4);
    mem.write8(0x4006, regs.a); m.step(0x0731, 13);
    mem.write8(0x400a, regs.a); m.step(0x0734, 13);
    m.push16(0x0737); m.step(0x1cb5, 17); m.call(0x1cb5);
    regs.de = 0x0600; m.step(0x073a, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk({ 0x1cb5: rst, 0x08f2: noop, 0x070d: noop });
  m.mem.write8(0x4006, 0x01); // bit0 set: correct code goes full-body
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x1cb5, 0x08f2]));
});
