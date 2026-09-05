// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0322 (ROM 0x0322-0x032d): set 0x400a=1, set 0x4008 pointer=0x0303, ret.
// Contract: 56 T (7+13+10+16+10), no calls, 0x400a=1, 0x4008=0x0303.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0322 } from "../loc_0322.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  const m = mk();
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_0322: state=1, pointer=0x0303; 56 T", () => {
  const m = run(loc_0322);
  assert.equal(m.cycles, 56, "sum of all instr T-states");
  assert.deepEqual(m.calls, [], "no calls");
  assert.equal(m.mem.read8(0x400a), 1, "0x400A state counter <- 1");
  assert.equal(m.mem.read16(0x4008), 0x0303, "0x4008 sequence pointer <- 0x0303");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0322.js
//   find: regs.hl = 0x0303;
//   repl: regs.hl = 0x0330;
//   expect: FAIL (0x4008 pointer becomes 0x0330; caught by the read16 assert)
test("loc_0322: contract catches a wrong sequence-pointer value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = 0x01; m.step(0x0324, 7);
    mem.write8(0x400a, regs.a); m.step(0x0327, 13);
    regs.hl = 0x0330; m.step(0x032a, 10); // MUTANT: wrong pointer
    mem.write16(0x4008, regs.hl); m.step(0x032d, 16);
    m.ret();
  };
  assert.throws(() => assert.equal(run(mutant).mem.read16(0x4008), 0x0303));
});
