// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0408 (ROM 0x0408-0x042f): rst-0x28 state idx 0. Contract: 195 T, calls
// [0x0598, 0x0010, 0x0010, 0x0010]; (0x4238)/(0x40b0)=0, (0x400b)=0x5002, (0x4009)=0x10, (0x400a) bumped.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0408 } from "../loc_0408.js";

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
// rst/call helper stubs pop the pushed return; loc_0408's asserted effects do not depend on loc_0010's fill.
const pop = (mm) => { mm.pop16(); };

test("loc_0408: table copy + zero-fills + pointer/state init; 195 T", () => {
  const m = mk({ 0x0598: pop, 0x0010: pop });
  m.mem.write8(0x400a, 5); // pre-existing state selector
  m.mem.write8(0x4238, 0xff); m.mem.write8(0x40b0, 0xff);
  m.push16(0x9999);
  loc_0408(m);
  assert.equal(m.cycles, 195, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x0598, 0x0010, 0x0010, 0x0010], "loc_0598 then three rst-0x10 fills");
  assert.equal(m.mem.read8(0x4238), 0, "(0x4238) cleared");
  assert.equal(m.mem.read8(0x40b0), 0, "(0x40b0) cleared");
  assert.equal(m.mem.read16(0x400b), 0x5002, "pointer (0x400b/0x400c) = 0x5002");
  assert.equal(m.mem.read8(0x4009), 0x10, "(0x4009) = 0x10");
  assert.equal(m.mem.read8(0x400a), 6, "(0x400a) bumped 5 -> 6");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0408.js
//   find: regs.incMem8(mem, regs.hl);  (at 0x042f, inc (0x400a))
//   repl: (drop it -- state selector not bumped)
//   expect: FAIL ((0x400a) stays 5; caught by the (0x400a)==6 assert)
test("loc_0408: contract catches a dropped state-selector bump", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x1d91; m.step(0x040b, 10);
    m.push16(0x040e); m.step(0x0598, 17); m.call(0x0598);
    regs.hl = 0x4060; m.step(0x0411, 10);
    regs.b = 0x40; m.step(0x0413, 7);
    regs.xor(regs.a); m.step(0x0414, 4);
    m.push16(0x0415); m.step(0x0010, 11); m.call(0x0010);
    regs.hl = 0x4260; m.step(0x0418, 10);
    m.push16(0x0419); m.step(0x0010, 11); m.call(0x0010);
    regs.b = 0x50; m.step(0x041b, 7);
    m.push16(0x041c); m.step(0x0010, 11); m.call(0x0010);
    mem.write8(0x4238, regs.a); m.step(0x041f, 13);
    mem.write8(0x40b0, regs.a); m.step(0x0422, 13);
    regs.hl = 0x5002; m.step(0x0425, 10);
    mem.write16(0x400b, regs.hl); m.step(0x0428, 16);
    regs.hl = 0x4009; m.step(0x042b, 10);
    mem.write8(regs.hl, 0x10); m.step(0x042d, 10);
    regs.l = regs.inc8(regs.l); m.step(0x042e, 4);
    m.step(0x042f, 11); // MUTANT: dropped inc (0x400a)
    return m.ret();
  };
  const m = mk({ 0x0598: pop, 0x0010: pop });
  m.mem.write8(0x400a, 5);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x400a), 6));
});
