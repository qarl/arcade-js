// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_070e (ROM 0x070e-0x0711): dec l (HL 0x400A->0x4009), ld (hl),0x50, ret.
// Contract: 24 T (4+10+10), no m.calls, 0x4009 <- 0x50.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_070e } from "../loc_070e.js";

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
  m.regs.hl = 0x400a;
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_070e: dec l + store 0x50 + ret; 24 T", () => {
  const m = run(loc_070e);
  assert.equal(m.cycles, 24, "4+10+10");
  assert.deepEqual(m.calls, []);
  assert.equal(m.regs.hl, 0x4009, "dec l -> 0x4009");
  assert.equal(m.mem.read8(0x4009), 0x50, "0x4009 <- 0x50");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_070e.js
//   find: mem.write8(regs.hl, 0x50);
//   repl: mem.write8(regs.hl, 0x51);   (wrong stored value)
//   expect: FAIL (0x4009 becomes 0x51; caught by the 0x4009 assert)
test("loc_070e: contract catches a wrong stored value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.l = regs.dec8(regs.l); m.step(0x070f, 4);
    mem.write8(regs.hl, 0x51); m.step(0x0711, 10); // MUTANT
    return m.ret();
  };
  assert.throws(() => assert.equal(run(mutant).mem.read8(0x4009), 0x50));
});
