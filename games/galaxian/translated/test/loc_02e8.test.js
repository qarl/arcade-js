// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_02e8 (ROM 0x02e8-0x02fc): rst-0x10 block-fill 0x4100-0x417F, clear 0x425F/0x4238,
// set 0x4009=0x40, tail-jump loc_0593. Contract: 88 T, calls [0x0010,0x0593], 0x4009=0x40, tail propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_02e8 } from "../loc_02e8.js";

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
// rst 0x10 stub: really fill B bytes at HL with A, then pop the pushed return (loc_0010 rets cleanly).
const rst10 = (mm) => { for (let i = 0; i < mm.regs.b; i++) mm.mem.write8((mm.regs.hl + i) & 0xffff, mm.regs.a); mm.pop16(); };
const tail = () => "TAIL";

function run(fn) {
  const m = mk({ 0x0010: rst10, 0x0593: tail });
  m.push16(0x9999);
  return { m, ret: fn(m) };
}

test("loc_02e8: block-fill + clears + timer, tail-jump 0x0593; 88 T", () => {
  const { m, ret } = run(loc_02e8);
  assert.equal(m.cycles, 88, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x0010, 0x0593], "rst 0x10 then tail-jump 0x0593");
  assert.equal(ret, "TAIL", "tail-jump callee result propagates out");
  assert.equal(m.mem.read8(0x4100), 0, "block-fill 0x4100 <- 0");
  assert.equal(m.mem.read8(0x417f), 0, "block-fill 0x417F <- 0 (B=0x80 bytes)");
  assert.equal(m.mem.read8(0x425f), 0, "0x425F cleared");
  assert.equal(m.mem.read8(0x4238), 0, "0x4238 cleared");
  assert.equal(m.mem.read8(0x4009), 0x40, "0x4009 timer <- 0x40");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_02e8.js
//   find: mem.write8(regs.hl, 0x40);
//   repl: mem.write8(regs.hl, 0x30);
//   expect: FAIL (0x4009 becomes 0x30; caught by the 0x4009 assert)
test("loc_02e8: contract catches a wrong timer value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4100; m.step(0x02eb, 10);
    regs.b = 0x80; m.step(0x02ed, 7);
    regs.xor(regs.a); m.step(0x02ee, 4);
    m.push16(0x02ef); m.step(0x0010, 11); m.call(0x0010);
    mem.write8(0x425f, regs.a); m.step(0x02f2, 13);
    mem.write8(0x4238, regs.a); m.step(0x02f5, 13);
    regs.hl = 0x4009; m.step(0x02f8, 10);
    mem.write8(regs.hl, 0x30); m.step(0x02fa, 10); // MUTANT: wrong timer
    m.step(0x0593, 10); return m.call(0x0593);
  };
  assert.throws(() => assert.equal(run(mutant).m.mem.read8(0x4009), 0x40));
});
