// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0156 (ROM 0x0156-0x0163): the (0x400a)-indexed rst-0x28 dispatcher.
//   0156  cd 0d 09  call 0x090d
//   0159  cd 8e 09  call 0x098e
//   015c  21 d7 03  ld hl,0x03d7
//   015f  e5        push hl        (continuation)
//   0160  3a 0a 40  ld a,(0x400a)
//   0163  ef        rst 0x28       (dispatch via inline table @0x0164)
// Contract: 79 T (17+17+10+11+13+11), calls [0x090d,0x098e,0x0028,0x03d7], A=(0x400a), rst-0x28 return
// (table base 0x0164) and continuation 0x03d7 pushed in that order, SP balanced.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0156 } from "../loc_0156.js";

function mk(seen) {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  const popStub = (mm) => { mm.pop16(); };
  m.routines.set(0x090d, popStub);
  m.routines.set(0x098e, popStub);
  // rst 0x28 dispatch: pop the table base, then the target's ret pops the continuation.
  m.routines.set(0x0028, (mm) => { seen.tableBase = mm.pop16(); seen.cont = mm.pop16(); });
  m.routines.set(0x03d7, () => "CONT");
  return m;
}

test("loc_0156: dispatch on (0x400a), continuation 0x03d7; 79 T", () => {
  const seen = {};
  const m = mk(seen);
  m.mem.write8(0x400a, 0x03); // sub-state index
  const ret = loc_0156(m);
  assert.equal(m.cycles, 79, "17+17+10+11+13+11");
  assert.deepEqual(m.calls, [0x090d, 0x098e, 0x0028, 0x03d7], "two setups, rst-0x28, then the continuation");
  assert.equal(m.regs.a, 0x03, "A = (0x400a)");
  assert.equal(seen.tableBase, 0x0164, "rst 0x28 pushed the inline table base");
  assert.equal(seen.cont, 0x03d7, "continuation the dispatched routine rets to");
  assert.equal(m.regs.sp, 0x4400, "SP balanced");
  assert.equal(ret, "CONT", "the continuation result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0156.js
//   find: regs.hl = 0x03d7;
//   repl: regs.hl = 0x03d8;
//   expect: FAIL (wrong continuation pushed, caught by the seen.cont assert)
test("loc_0156: the contract catches a wrong continuation address", () => {
  const seen = {};
  const m = mk(seen);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    mm.push16(0x0159); mm.step(0x090d, 17); mm.call(0x090d);
    mm.push16(0x015c); mm.step(0x098e, 17); mm.call(0x098e);
    regs.hl = 0x03d8; mm.step(0x015f, 10); // MUTANT
    mm.push16(regs.hl); mm.step(0x0160, 11);
    regs.a = mem.read8(0x400a); mm.step(0x0163, 13);
    mm.push16(0x0164); mm.step(0x0028, 11); mm.call(0x0028);
    return mm.call(0x03d7);
  };
  mutant(m);
  assert.throws(() => assert.equal(seen.cont, 0x03d7));
});
