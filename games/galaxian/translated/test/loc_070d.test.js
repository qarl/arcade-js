// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_070d (ROM 0x070d): inc (hl) then fall through -> loc_070e.
// Contract: 11 T (inc (hl)), tail m.call([0x070e]), (0x400A) incremented.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_070d } from "../loc_070d.js";

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

function run(fn) {
  const m = mk({ 0x070e: () => "E" });
  m.regs.hl = 0x400a;
  m.mem.write8(0x400a, 0x05);
  return { m, ret: fn(m) };
}

test("loc_070d: inc (hl) + delegate to loc_070e; 11 T", () => {
  const { m, ret } = run(loc_070d);
  assert.equal(m.cycles, 11, "inc (hl)");
  assert.deepEqual(m.calls, [0x070e], "fall-through delegates to loc_070e");
  assert.equal(m.mem.read8(0x400a), 0x06, "inc (0x400a) 5 -> 6");
  assert.equal(ret, "E", "loc_070e result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_070d.js
//   find: regs.incMem8(mem, regs.hl);
//   repl: regs.decMem8(mem, regs.hl);   (dec instead of inc)
//   expect: FAIL (0x400a becomes 0x04; caught by the 0x400a assert)
test("loc_070d: contract catches inc replaced by dec", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.decMem8(mem, regs.hl); m.step(0x070e, 11); // MUTANT
    return m.call(0x070e);
  };
  assert.throws(() => assert.equal(run(mutant).m.mem.read8(0x400a), 0x06));
});
