// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0f07 (ROM 0x0f07-0x0f3b): object AI state handler. Exercises the "nudge (ix+5) up"
// path: call 0x1147 leaves b so delta=(ix+3)-b is small/even, (ix+6) dir bit clear -> inc (ix+5); ret.
// Contract on that path: 173 T, calls [0x1147], (ix+3)<-b, (ix+5) incremented.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0f07 } from "../loc_0f07.js";

const IX = 0x4100;

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = IX;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// 0x1147 stub: pop the call's pushed return, then force b so post-call delta = 0x10-0x0c = 4 (small, even).
const helper1147 = (mm) => { mm.pop16(); mm.regs.b = 0x0c; };

function seed(m) {
  m.mem.write8(IX + 0x03, 0x10); // (ix+3) counter
  m.mem.write8(IX + 0x05, 0x20); // (ix+5) nudged value
  m.mem.write8(IX + 0x06, 0x00); // (ix+6) dir bit clear -> UP arm
}

test("loc_0f07: dir-up arm — inc (ix+5), 173 T, one call to 0x1147", () => {
  const m = mk({ 0x1147: helper1147 });
  m.push16(0x9999); // caller return
  seed(m);
  loc_0f07(m);
  assert.equal(m.cycles, 173, "sum of exercised-path T-states");
  assert.deepEqual(m.calls, [0x1147], "call 0x1147 once");
  assert.equal(m.mem.read8(IX + 0x03), 0x0c, "(ix+3) <- b");
  assert.equal(m.mem.read8(IX + 0x05), 0x21, "inc (ix+5): 0x20 -> 0x21");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0f07.js
//   find: regs.incMem8(mem, (regs.ix + 0x05) & 0xffff);   (the dir-up arm)
//   repl: regs.decMem8(mem, (regs.ix + 0x05) & 0xffff);
//   expect: FAIL — (ix+5) becomes 0x1f, not 0x21 (caught by the (ix+5) assert)
test("loc_0f07: contract catches inc<->dec swap on the (ix+5) nudge", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.b = mem.read8((regs.ix + 0x03) & 0xffff); m.step(0x0f0a, 19);
    regs.b = regs.inc8(regs.b); m.step(0x0f0b, 4);
    m.push16(0x0f0e); m.step(0x1147, 17); m.call(0x1147);
    regs.a = mem.read8((regs.ix + 0x03) & 0xffff); m.step(0x0f11, 19);
    mem.write8((regs.ix + 0x03) & 0xffff, regs.b); m.step(0x0f14, 19);
    regs.sub(regs.b); m.step(0x0f15, 4);
    m.step(0x0f17, 7);
    regs.cp(0x19); m.step(0x0f19, 7); m.step(0x0f1a, 5);
    regs.and(0x01); m.step(0x0f1c, 7); m.step(0x0f1d, 5);
    const ea = (regs.ix + 0x06) & 0xffff;
    regs.bit(0, mem.read8(ea), ea >> 8); m.step(0x0f21, 20);
    m.step(0x0f23, 7);
    regs.decMem8(mem, (regs.ix + 0x05) & 0xffff); m.step(0x0f26, 23); // MUTANT: dec not inc
    m.ret();
  };
  const m = mk({ 0x1147: helper1147 });
  m.push16(0x9999);
  seed(m);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(IX + 0x05), 0x21));
});
