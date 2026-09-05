// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1801 (Galaxian, ROM 0x1801-0x180b):
//   7e            ld a,(hl)
//   e6 03         and 0x03
//   c2 0c 18      jp nz,0x180c   -- low 2 bits set: tail to loc_180c
//   3e 60         ld a,0x60
//   c3 15 18      jp 0x1815      -- else A=0x60, tail to loc_1815
// Contract A ((hl)&3 == 0): 5 instr, 41 T (7+7+10+7+10), A=0x60, tail-jumps loc_1815.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1801 } from "../loc_1801.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) routines.set(Number(a), () => k);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, cell, stubs = {}) {
  const m = mk(stubs);
  m.regs.hl = 0x4210;
  m.mem.write8(0x4210, cell);
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret, a: m.regs.a };
}

function checkSpec(r) {
  assert.equal(r.cycles, 41, "T (7+7+10+7+10)");
  assert.deepEqual(r.calls, [0x1815], "(hl)&3==0: A=0x60, tail to loc_1815");
  assert.equal(r.ret, "15", "the tail callee's result propagates");
  assert.equal(r.a, 0x60, "A loaded with 0x60");
}

test("loc_1801: (hl)&3==0 -> A=0x60, tail-jump loc_1815; 41 T", () => {
  checkSpec(run(loc_1801, 0x04, { 0x1815: "15" }));
});

test("loc_1801: (hl)&3 nonzero -> jp nz tail to loc_180c (24 T)", () => {
  const r = run(loc_1801, 0x02, { 0x180c: "0C" });
  assert.equal(r.cycles, 24, "7+7+10");
  assert.deepEqual(r.calls, [0x180c]);
  assert.equal(r.a, 0x02, "A = (hl)&3 on the loc_180c path (0x02)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1801.js
//   find: regs.a = 0x60;
//   repl: regs.a = 0x50;
//   expect: FAIL (A ends 0x50 -- caught by the A==0x60 assertion)
test("loc_1801: contract catches a wrong immediate", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(regs.hl); m.step(0x1802, 7);
    regs.and(0x03); m.step(0x1804, 7);
    if (regs.fNZ) { m.step(0x180c, 10); return m.call(0x180c); }
    m.step(0x1807, 10);
    regs.a = 0x50; m.step(0x1809, 7); // MUTANT: wrong immediate
    m.step(0x1815, 10);
    return m.call(0x1815);
  };
  assert.throws(() => checkSpec(run(mutant, 0x04, { 0x1815: "15" })));
});
