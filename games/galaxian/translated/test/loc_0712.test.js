// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0712 (ROM 0x0712-0x0721): test bit0 of 0x4006; if set store 0x04 at (HL), if clear
// store 0x0e (loc_071d inlined); either way tail-jp loc_070e. bit0-set: 44 T; bit0-clear: 49 T, (HL)<-0x0e.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0712 } from "../loc_0712.js";

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

function run(fn, flag = 0x01) {
  const m = mk({ 0x070e: () => "E" });
  m.regs.hl = 0x400a;
  m.mem.write8(0x4006, flag);
  return { m, ret: fn(m) };
}

test("loc_0712: bit0 set -> store 0x04 + tail loc_070e; 44 T", () => {
  const { m, ret } = run(loc_0712, 0x01);
  assert.equal(m.cycles, 44, "13+4+7+10+10");
  assert.deepEqual(m.calls, [0x070e]);
  assert.equal(m.mem.read8(0x400a), 0x04, "(HL) <- 0x04");
  assert.equal(ret, "E");
});

test("loc_0712: bit0 clear -> inlined loc_071d stores 0x0e + tail loc_070e; 49 T", () => {
  const { m, ret } = run(loc_0712, 0x00);
  assert.equal(m.cycles, 49, "13+4+12+10+10");
  assert.deepEqual(m.calls, [0x070e], "tails to loc_070e, no separate loc_071d call");
  assert.equal(m.mem.read8(0x400a), 0x0e, "(HL) <- 0x0e (the 0x071d arm)");
  assert.equal(ret, "E");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0712.js
//   find: mem.write8(regs.hl, 0x04);
//   repl: mem.write8(regs.hl, 0x05);   (wrong stored value)
//   expect: FAIL (0x400a becomes 0x05; caught by the (HL) assert)
test("loc_0712: contract catches a wrong stored value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4006); m.step(0x0715, 13);
    regs.rrca(); m.step(0x0716, 4);
    if (regs.fNC) {
      m.step(0x071d, 12); mem.write8(regs.hl, 0x0e); m.step(0x071f, 10);
      m.step(0x070e, 10); return m.call(0x070e);
    }
    m.step(0x0718, 7);
    mem.write8(regs.hl, 0x05); m.step(0x071a, 10); // MUTANT
    m.step(0x070e, 10); return m.call(0x070e);
  };
  assert.throws(() => assert.equal(run(mutant, 0x01).m.mem.read8(0x400a), 0x04));
});
