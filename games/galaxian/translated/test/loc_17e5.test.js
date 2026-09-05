// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_17e5 (Galaxian, ROM 0x17e5-0x17f8, falls into loc_17f9):
//   3a 26 42 rrca d8   gate on (0x4226) bit0 -> ret c if set
//   23                 inc hl
//   3a 5f 42 rrca 3810 gate on (0x425f) bit0 -> jr c,0x1801 if set
//   3a c4 41 fe 60     A=(0x41c4), cp 0x60
//   3001               jr nc,0x17f9 -- A>=0x60: skip the inc
//   34                 inc (hl)
// Contract (both gates clear, A<0x60): 11 instr, 90 T (13+4+5+6+13+4+7+13+7+7+11), inc's (HL+1), then
// tail-delegates to loc_17f9.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_17e5 } from "../loc_17e5.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.regs.sp = 0x4390; m.mem.write16(0x4390, 0x9999);
  return m;
}

function run(fn, g4226, g425f, c41c4, hl, stubs = {}) {
  const m = mk(stubs);
  m.mem.write8(0x4226, g4226);
  m.mem.write8(0x425f, g425f);
  m.mem.write8(0x41c4, c41c4);
  m.regs.hl = hl;
  m.mem.write8((hl + 1) & 0xffff, 0x05); // the cell inc (hl) will bump, after inc hl
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret };
}

function checkSpec(r) {
  assert.equal(r.cycles, 90, "T (13+4+5+6+13+4+7+13+7+7+11)");
  assert.deepEqual(r.calls, [0x17f9], "falls through into loc_17f9");
  assert.equal(r.m.mem.read8(0x4201), 0x06, "inc (hl) bumped (0x4201) 5->6 (HL was 0x4200, inc hl->0x4201)");
}

test("loc_17e5: both gates clear + A<0x60 -> inc (hl), delegate loc_17f9; 90 T", () => {
  checkSpec(run(loc_17e5, 0x00, 0x00, 0x10, 0x4200, { 0x17f9: "F9" }));
});

test("loc_17e5: (0x4226) bit0 set -> ret c (28 T, no delegate)", () => {
  const r = run(loc_17e5, 0x01, 0x00, 0x10, 0x4200);
  assert.equal(r.cycles, 28, "13+4+11 (ret c taken)");
  assert.deepEqual(r.calls, []);
});

test("loc_17e5: (0x425f) bit0 set -> jr c tail to loc_1801", () => {
  const r = run(loc_17e5, 0x00, 0x01, 0x10, 0x4200, { 0x1801: "01" });
  assert.deepEqual(r.calls, [0x1801], "second gate set: tail-jumps loc_1801");
  assert.equal(r.ret, "01");
  assert.equal(r.m.mem.read8(0x4201), 0x05, "inc (hl) NOT reached on the loc_1801 path");
});

test("loc_17e5: A>=0x60 -> jr nc skips the inc, still delegates loc_17f9", () => {
  const r = run(loc_17e5, 0x00, 0x00, 0x60, 0x4200, { 0x17f9: "F9" });
  assert.deepEqual(r.calls, [0x17f9]);
  assert.equal(r.m.mem.read8(0x4201), 0x05, "inc skipped when A>=0x60");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_17e5.js
//   find: regs.cp(0x60);
//   repl: regs.cp(0x00);
//   expect: FAIL (A=0x10 >= 0x00 -> jr nc taken -> inc skipped; (0x4201) stays 0x05, cycles differ)
test("loc_17e5: contract catches a wrong cp threshold", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4226); m.step(0x17e8, 13);
    regs.rrca(); m.step(0x17e9, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x17ea, 5);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x17eb, 6);
    regs.a = mem.read8(0x425f); m.step(0x17ee, 13);
    regs.rrca(); m.step(0x17ef, 4);
    if (regs.fC) { m.step(0x1801, 12); return m.call(0x1801); }
    m.step(0x17f1, 7);
    regs.a = mem.read8(0x41c4); m.step(0x17f4, 13);
    regs.cp(0x00); m.step(0x17f6, 7); // MUTANT: wrong threshold
    if (regs.fNC) { m.step(0x17f9, 12); return m.call(0x17f9); }
    m.step(0x17f8, 7);
    regs.incMem8(mem, regs.hl); m.step(0x17f9, 11);
    return m.call(0x17f9);
  };
  assert.throws(() => checkSpec(run(mutant, 0x00, 0x00, 0x10, 0x4200, { 0x17f9: "F9" })));
});
