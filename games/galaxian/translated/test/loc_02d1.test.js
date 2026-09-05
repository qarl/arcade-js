// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_02d1 (ROM 0x02d1-0x02e7): enqueue 0x0701 and 0x0600 via loc_08f2, inc (0x400a),
// set 0x4008 pointer = 0x1060, ret. Contract: 111 T, calls [0x08f2,0x08f2], 0x400a=1, 0x4008=0x1060.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_02d1 } from "../loc_02d1.js";

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
// loc_08f2 stub: record DE, pop the call's return address (the real routine rets cleanly).
const enqueue = (mm) => { mm.enq = mm.enq || []; mm.enq.push(mm.regs.de); mm.pop16(); };

function run(fn) {
  const m = mk({ 0x08f2: enqueue });
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_02d1: enqueues two words, sets state + pointer; 111 T", () => {
  const m = run(loc_02d1);
  assert.equal(m.cycles, 111, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x08f2, 0x08f2], "two loc_08f2 enqueue calls");
  assert.deepEqual(m.enq, [0x0701, 0x0600], "DE at each enqueue");
  assert.equal(m.mem.read8(0x400a), 1, "inc (0x400a) state counter");
  assert.equal(m.mem.read16(0x4008), 0x1060, "0x4008 sequence pointer <- 0x1060");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_02d1.js
//   find: regs.hl = 0x1060;
//   repl: regs.hl = 0x1050;
//   expect: FAIL (0x4008 pointer becomes 0x1050; caught by the read16 assert)
test("loc_02d1: contract catches a wrong sequence-pointer value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.de = 0x0701; m.step(0x02d4, 10);
    m.push16(0x02d7); m.step(0x08f2, 17); m.call(0x08f2);
    regs.de = 0x0600; m.step(0x02da, 10);
    m.push16(0x02dd); m.step(0x08f2, 17); m.call(0x08f2);
    regs.hl = 0x400a; m.step(0x02e0, 10);
    regs.incMem8(mem, regs.hl); m.step(0x02e1, 11);
    regs.hl = 0x1050; m.step(0x02e4, 10); // MUTANT: wrong pointer
    mem.write16(0x4008, regs.hl); m.step(0x02e7, 16);
    m.ret();
  };
  assert.throws(() => assert.equal(run(mutant).mem.read16(0x4008), 0x1060));
});
