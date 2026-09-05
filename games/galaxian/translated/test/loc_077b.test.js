// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_077b (ROM 0x077b-0x0784): call loc_090d, call loc_098e, A=(0x400a), rst 0x28.
// Contract 58 T (17+17+13+11); calls [0x090d,0x098e,0x0028]; rst 0x28 pushes inline table base 0x0785.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_077b } from "../loc_077b.js";

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
const popStub = (mm) => { mm.pop16(); };                  // call return-addr eater
const rst28 = (mm) => { mm.tableBase = mm.pop16(); };     // loc_0028 pops the inline table base

test("loc_077b: two calls then rst-0x28 dispatch on (0x400a); 58 T, table base 0x0785", () => {
  const m = mk({ 0x090d: popStub, 0x098e: popStub, 0x0028: rst28 });
  m.mem.write8(0x400a, 0x06);
  m.push16(0x9999);
  loc_077b(m);
  assert.equal(m.cycles, 58, "17+17+13+11");
  assert.deepEqual(m.calls, [0x090d, 0x098e, 0x0028], "loc_090d, loc_098e, then rst 0x28");
  assert.equal(m.regs.a, 0x06, "A = (0x400a) sub-state index");
  assert.equal(m.tableBase, 0x0785, "rst 0x28 pushed the inline table base 0x0785");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_077b.js
//   find: m.push16(0x0785);
//   repl: m.push16(0x0787);
//   expect: FAIL (dispatch reads the table one entry high; caught by the table-base assert)
test("loc_077b: the contract catches a wrong rst-0x28 table base", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x077e); m.step(0x090d, 17); m.call(0x090d);
    m.push16(0x0781); m.step(0x098e, 17); m.call(0x098e);
    regs.a = mem.read8(0x400a); m.step(0x0784, 13);
    m.push16(0x0787); m.step(0x0028, 11); return m.call(0x0028); // MUTANT: wrong table base
  };
  const m = mk({ 0x090d: popStub, 0x098e: popStub, 0x0028: rst28 });
  m.mem.write8(0x400a, 0x06);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.tableBase, 0x0785));
});
