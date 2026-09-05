// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_17d0 (Galaxian, ROM 0x17d0-0x17e4):
//   3a 06 40 rrca d0     gate on (0x4006) bit0 -> ret nc if clear
//   21 c2 41 7e 3d       HL=0x41c2, A=(counter), dec a
//   c2 e5 17             jp nz,0x17e5 -- counter still nonzero: tail to loc_17e5
//   77 21 02 a0 22 c3 41 (0x41c2)=0, 0x41c3/0x41c4 = 0xa002
//   c9                   ret
// Contract A (gate set, counter hits 0): 11 instr, 96 T (13+4+5+10+7+4+10+7+10+16+10), no m.call, plain ret,
// (0x41c2)=0, 0x41c3=0x02, 0x41c4=0xa0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_17d0 } from "../loc_17d0.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.regs.sp = 0x4390; m.mem.write16(0x4390, 0x9999); // fake return frame for the terminal ret
  return m;
}

function run(fn, gate, counter, stubs = {}) {
  const m = mk(stubs);
  m.mem.write8(0x4006, gate);
  m.mem.write8(0x41c2, counter);
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret };
}

function checkSpec(r) {
  assert.equal(r.cycles, 96, "T-state total (13+4+5+10+7+4+10+7+10+16+10)");
  assert.deepEqual(r.calls, [], "counter reaches 0: plain ret, no dispatch");
  assert.equal(r.m.mem.read8(0x41c2), 0, "(0x41c2) zeroed");
  assert.equal(r.m.mem.read8(0x41c3), 0x02, "0x41c3 low = 0x02 (of 0xa002)");
  assert.equal(r.m.mem.read8(0x41c4), 0xa0, "0x41c4 high = 0xa0 (of 0xa002)");
}

test("loc_17d0: gate set + counter->0 stores 0xa002 and returns; 96 T", () => {
  checkSpec(run(loc_17d0, 0x01, 0x01));
});

test("loc_17d0: gate clear -> ret nc (28 T, no store)", () => {
  const r = run(loc_17d0, 0x00, 0x01);
  assert.equal(r.cycles, 28, "13+4+11");
  assert.deepEqual(r.calls, []);
  assert.equal(r.m.mem.read8(0x41c3), 0, "no 0xa002 store on the gated exit");
});

test("loc_17d0: gate set + counter still nonzero -> tail-jump loc_17e5", () => {
  const r = run(loc_17d0, 0x01, 0x02, { 0x17e5: "E5" });
  assert.deepEqual(r.calls, [0x17e5], "dec 2->1 nonzero: tail to loc_17e5");
  assert.equal(r.ret, "E5", "the tail callee's result propagates");
  assert.equal(r.m.mem.read8(0x41c2), 0x02, "counter NOT written on the tail path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_17d0.js
//   find: regs.hl = 0xa002;
//   repl: regs.hl = 0xa003;
//   expect: FAIL (0x41c3 becomes 0x03 -- caught by the 0x41c3==0x02 assertion)
test("loc_17d0: contract catches a wrong stored value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4006); m.step(0x17d3, 13);
    regs.rrca(); m.step(0x17d4, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x17d5, 5);
    regs.hl = 0x41c2; m.step(0x17d8, 10);
    regs.a = mem.read8(regs.hl); m.step(0x17d9, 7);
    regs.a = regs.dec8(regs.a); m.step(0x17da, 4);
    if (regs.fNZ) { m.step(0x17e5, 10); return m.call(0x17e5); }
    m.step(0x17dd, 10);
    mem.write8(regs.hl, regs.a); m.step(0x17de, 7);
    regs.hl = 0xa003; m.step(0x17e1, 10); // MUTANT: wrong value
    mem.write16(0x41c3, regs.hl); m.step(0x17e4, 16);
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant, 0x01, 0x01)));
});
