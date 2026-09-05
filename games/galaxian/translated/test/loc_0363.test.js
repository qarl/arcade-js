// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0363 (ROM 0x0363-0x0366):
//   0363 af        xor a          ; A=0
//   0364 c3 72 09  jp 0x0972      ; tail-jump into the shared per-state setup
// Contract: A=0, tail-calls loc_0972; 14 T (4 + 10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0363 } from "../loc_0363.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(m, ret) {
  assert.equal(m.cycles, 14, "4 + 10");
  assert.deepEqual(m.calls, [0x0972], "tail-calls loc_0972");
  assert.equal(ret, "TAIL", "tail-call result propagates");
  assert.equal(m.regs.a, 0x00, "A cleared");
}

test("loc_0363: clears A, tail-calls loc_0972; 14 T", () => {
  const m = mk({ 0x0972: "tail" });
  m.regs.a = 0xff;
  const ret = loc_0363(m);
  checkSpec(m, ret);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0363.js
//   find: regs.xor(regs.a);
//   repl: regs.a = 0x01;
//   expect: FAIL (A is left nonzero)
test("loc_0363: the contract catches a non-cleared A", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.a = 0x01; m.step(0x0364, 4); // MUTANT
    m.step(0x0972, 10);
    return m.call(0x0972);
  };
  const m = mk({ 0x0972: "tail" });
  m.regs.a = 0xff;
  const ret = mutant(m);
  assert.throws(() => checkSpec(m, ret));
});
