// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2055 (ROM 0x2055-0x205d): first entry of the jp(hl) dispatch table at 0x203d.
// call 0x20e1, call 0x2104, then tail-jump 0x2131. Contract: calls [0x20e1,0x2104,0x2131], 44 T, the
// tail-jump's result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2055 } from "../loc_2055.js";

function mk(stubs) {
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
const pop = (mm) => { mm.pop16(); }; // a `call ... ret` callee: balance the pushed return

function run(fn, stubs) {
  const m = mk(stubs);
  m.push16(0x9999);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret };
}

function checkSpec(res) {
  assert.equal(res.cycles, 44, "17 + 17 + 10");
  assert.deepEqual(res.calls, [0x20e1, 0x2104, 0x2131], "two calls then the tail-jump");
  assert.equal(res.ret, "TAIL", "the tail-jump's callee result propagates out");
}

test("loc_2055: call 0x20e1, call 0x2104, tail-jump 0x2131; 44 T", () => {
  checkSpec(run(loc_2055, { 0x20e1: pop, 0x2104: pop, 0x2131: () => "TAIL" }));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2055.js
//   find: m.step(0x2131, 10);\n  return m.call(0x2131);
//   repl: m.step(0x2231, 10);\n  return m.call(0x2231);
//   expect: FAIL -- tail-jumps to 0x2231 (caught by the calls sequence)
test("loc_2055: contract catches a wrong tail-jump target", () => {
  const mutant = (m) => {
    m.push16(0x2058); m.step(0x20e1, 17); m.call(0x20e1);
    m.push16(0x205b); m.step(0x2104, 17); m.call(0x2104);
    m.step(0x2231, 10); // MUTANT: wrong target
    return m.call(0x2231);
  };
  assert.throws(() =>
    checkSpec(run(mutant, { 0x20e1: pop, 0x2104: pop, 0x2231: () => "TAIL" })),
  );
});
