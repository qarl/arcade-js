// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_21f8 (ROM 0x21f8-0x21fd): ld ix,0x5241, jr 0x2261.
// Contract: 26 T (14+12), calls [0x2261], IX=0x5241, tail result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_21f8 } from "../loc_21f8.js";

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
const tail = () => "TAIL";

function run(fn, stubs = { 0x2261: tail }) {
  const m = mk(stubs);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, ix: m.regs.ix };
}

function checkSpec(res) {
  assert.equal(res.cycles, 26, "T-state total (14+12)");
  assert.deepEqual(res.calls, [0x2261], "tail-jr into loc_2261");
  assert.equal(res.ret, "TAIL", "tail-jump result propagates out");
  assert.equal(res.ix, 0x5241, "ld ix,0x5241 -- VRAM dest pointer");
}

test("loc_21f8: sets IX and tail-jumps to loc_2261; 26 T", () => {
  checkSpec(run(loc_21f8));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_21f8.js
//   find: regs.ix = 0x5241;
//   repl: regs.ix = 0x5341;
//   expect: FAIL (wrong VRAM pointer -- caught by ix == 0x5241)
test("loc_21f8: the contract catches a wrong IX value", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.ix = 0x5341; m.step(0x21fc, 14); // MUTANT: wrong pointer
    m.step(0x2261, 12);
    return m.call(0x2261);
  };
  const m = mk({ 0x2261: tail });
  mutant(m);
  assert.throws(() => assert.equal(m.regs.ix, 0x5241));
});
