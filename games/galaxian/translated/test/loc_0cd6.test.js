// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0cd6 (ROM 0x0cd6-0x0ce5): per-slot object driver. (ix+1) set -> hand off to 0x10e4;
// (ix+0) clear -> ret; else state-dispatch on (ix+2) via rst 0x28 (pushes table base 0x0ce6, calls 0x0028).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0cd6 } from "../loc_0cd6.js";

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
// loc_0028 stand-in: pop the pushed table base, then the dispatched target rets to the caller.
const dispatch = (mm) => { mm.dispatchBase = mm.pop16(); mm.pc = mm.pop16(); };
// loc_10e4 stand-in: rets to the caller.
const handoff = (mm) => { mm.pc = mm.pop16(); };

test("loc_0cd6: active slot -> rst-28 dispatch on (ix+2); table base 0x0ce6; 85 T", () => {
  const m = mk({ 0x0028: dispatch });
  m.regs.ix = 0x42b0;
  m.mem.write8(0x42b0 + 0x01, 0x00); // (ix+1) clear -> no handoff
  m.mem.write8(0x42b0 + 0x00, 0x01); // (ix+0) set -> not the ret-z path
  m.mem.write8(0x42b0 + 0x02, 0x03); // state index
  m.push16(0xcafe); // caller (loc_0cc3) return
  loc_0cd6(m);
  assert.equal(m.cycles, 85, "sum of all instr T-states up to the rst");
  assert.deepEqual(m.calls, [0x0028], "rst 0x28 dispatches through loc_0028");
  assert.equal(m.dispatchBase, 0x0ce6, "pushed rst return = inline table base");
  assert.equal(m.regs.a, 0x03, "A = (ix+2) state index");
  assert.equal(m.pc, 0xcafe, "dispatched target rets to the caller");
});

test("loc_0cd6: (ix+1) set hands off to 0x10e4; 30 T", () => {
  const m = mk({ 0x10e4: handoff });
  m.regs.ix = 0x42b0;
  m.mem.write8(0x42b0 + 0x01, 0x01); // (ix+1) set
  m.push16(0xcafe);
  loc_0cd6(m);
  assert.equal(m.cycles, 30, "bit + jp nz taken");
  assert.deepEqual(m.calls, [0x10e4], "handed off");
  assert.equal(m.pc, 0xcafe, "10e4 rets to the caller");
});

test("loc_0cd6: (ix+0) clear -> ret z, no dispatch", () => {
  const m = mk({});
  m.regs.ix = 0x42b0;
  m.mem.write8(0x42b0 + 0x01, 0x00); // (ix+1) clear
  m.mem.write8(0x42b0 + 0x00, 0x00); // (ix+0) clear -> ret z
  m.push16(0xcafe);
  loc_0cd6(m);
  assert.equal(m.cycles, 20 + 10 + 20 + 11, "bit,jp nz nt,bit,ret z taken");
  assert.deepEqual(m.calls, [], "inactive slot does nothing");
  assert.equal(m.pc, 0xcafe, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0cd6.js
//   find: m.push16(0x0ce6);   repl: m.push16(0x0000);
//   expect: FAIL -- loc_0028 would read the wrong inline table base; caught by the dispatchBase assert.
test("loc_0cd6: the contract catches a wrong rst-28 table base", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.bit(0, mem.read8((regs.ix + 0x01) & 0xffff)); m.step(0x0cda, 20);
    m.step(0x0cdd, 10);
    regs.bit(0, mem.read8((regs.ix + 0x00) & 0xffff)); m.step(0x0ce1, 20);
    m.step(0x0ce2, 5);
    regs.a = mem.read8((regs.ix + 0x02) & 0xffff); m.step(0x0ce5, 19);
    m.push16(0x0000); // MUTANT: wrong table base
    m.step(0x0028, 11);
    return m.call(0x0028);
  };
  const m = mk({ 0x0028: dispatch });
  m.regs.ix = 0x42b0;
  m.mem.write8(0x42b0 + 0x02, 0x03);
  m.push16(0xcafe);
  mutant(m);
  assert.throws(() => assert.equal(m.dispatchBase, 0x0ce6));
});
