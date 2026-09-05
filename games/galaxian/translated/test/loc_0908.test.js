// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0908 (Galaxian queue-head commit, ROM 0x0908-0x090a):
//   0908  32 a0 40  ld (0x40a0),a   ; store the updated write-head index
//         -> fall through to loc_090b
// Contract: 1 instr, 13 T, (0x40a0) = A, tail-jumps loc_090b.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0908 } from "../loc_0908.js";

function mk() {
  const routines = new Map([[0x090b, () => "TAIL"]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run() {
  const m = mk();
  m.mem.write8(0x40a0, 0x00);
  m.regs.a = 0xc4;
  const ret = loc_0908(m);
  return { cycles: m.cycles, calls: m.calls, ret, head: m.mem.read8(0x40a0) };
}

function checkSpec(r) {
  assert.equal(r.cycles, 13, "ld (nn),a = 13 T");
  assert.deepEqual(r.calls, [0x090b], "falls through to loc_090b");
  assert.equal(r.ret, "TAIL", "callee result propagates");
  assert.equal(r.head, 0xc4, "wrote A into 0x40a0 (queue write-head)");
}

test("loc_0908: commits A to the 0x40a0 write-head, tail-jumps 0x090b; 13 T", () => {
  checkSpec(run());
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0908.js
//   find: mem.write8(0x40a0, regs.a);
//   repl: mem.write8(0x40a1, regs.a);
//   expect: FAIL  (wrong cell -> 0x40a0 stays 0, caught by head == 0xc4)
//   verified-anchor: count == 1  (the sole write in loc_0908.js)
test("loc_0908: the contract catches a wrong head cell", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(0x40a1, regs.a); // MUTANT: wrong address
    m.step(0x090b, 13);
    return m.call(0x090b);
  };
  const m = mk();
  m.mem.write8(0x40a0, 0x00);
  m.regs.a = 0xc4;
  const ret = mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, ret, head: m.mem.read8(0x40a0) }));
});
