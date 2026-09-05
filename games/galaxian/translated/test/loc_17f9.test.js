// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_17f9 (Galaxian, ROM 0x17f9-0x1800, falls into loc_1801):
//   a7            and a          -- test A (Z, clears carry)
//   ca 01 18      jp z,0x1801    -- A==0: straight to loc_1801
//   3d            dec a
//   32 c4 41      ld (0x41c4),a  -- counter
// Contract (A nonzero): 4 instr, 31 T (4+10+4+13), stores A-1 to (0x41c4), delegates loc_1801.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_17f9 } from "../loc_17f9.js";

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

function run(fn, a, stubs = { 0x1801: "01" }) {
  const m = mk(stubs);
  m.mem.write8(0x41c4, 0xee); // sentinel to observe (or not) the store
  m.regs.a = a;
  const ret = fn(m);
  return { m, cycles: m.cycles, calls: m.calls, ret };
}

function checkSpec(r) {
  assert.equal(r.cycles, 31, "T (4+10+4+13)");
  assert.deepEqual(r.calls, [0x1801], "falls through into loc_1801");
  assert.equal(r.ret, "01", "the delegate's result propagates");
  assert.equal(r.m.mem.read8(0x41c4), 0x04, "A(0x05)-1 = 0x04 stored to counter");
}

test("loc_17f9: A nonzero decrements + stores to (0x41c4), delegates loc_1801; 31 T", () => {
  checkSpec(run(loc_17f9, 0x05));
});

test("loc_17f9: A==0 -> jp z straight to loc_1801 (14 T, no store)", () => {
  const r = run(loc_17f9, 0x00);
  assert.equal(r.cycles, 14, "4+10");
  assert.deepEqual(r.calls, [0x1801]);
  assert.equal(r.m.mem.read8(0x41c4), 0xee, "counter untouched on the A==0 path");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_17f9.js
//   find: mem.write8(0x41c4, regs.a);
//   repl: mem.write8(0x41c5, regs.a);
//   expect: FAIL (0x41c4 keeps its sentinel -- caught by the (0x41c4)==0x04 assertion)
test("loc_17f9: contract catches a wrong store address", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.and(regs.a); m.step(0x17fa, 4);
    if (regs.fZ) { m.step(0x1801, 10); return m.call(0x1801); }
    m.step(0x17fd, 10);
    regs.a = regs.dec8(regs.a); m.step(0x17fe, 4);
    mem.write8(0x41c5, regs.a); m.step(0x1801, 13); // MUTANT: wrong address
    return m.call(0x1801);
  };
  assert.throws(() => checkSpec(run(mutant, 0x05)));
});
