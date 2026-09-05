// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0e2b (ROM 0x0e2b-0x0e6a): object state handler slot 3. Contract on the "walk the
// per-object table" path (target-Y in range, 0x4200 bit0 set, 0x422b bit0 clear, one table row scanned):
// 289 T, calls [0x116b,0x11b0], (ix+0x04)=target Y, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0e2b } from "../loc_0e2b.js";

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
const pop = (mm) => { mm.pop16(); }; // callee stub: balance the pushed return

function seed(m) {
  const { mem } = m;
  m.regs.ix = 0x4300;
  mem.write8(0x4303, 0x00); // (ix+0x03) pos
  mem.write8(0x4309, 0x10); // (ix+0x09)
  mem.write8(0x4319, 0x00); // (ix+0x19)
  mem.write8(0x4200, 0x01); // bit0 set -> ret nc NOT taken
  mem.write8(0x422b, 0x00); // bit0 clear -> ret c NOT taken
  mem.write8(0x4213, 0x01); // L = row count (1)
  mem.write8(0x4214, 0xff); // H = match value (never matches A)
}

function run(fn) {
  const m = mk({ 0x116b: pop, 0x11b0: pop, 0x11e0: pop });
  seed(m);
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_0e2b: table-scan path -- 289 T, calls [0x116b,0x11b0], (ix+0x04)=0x10", () => {
  const m = run(loc_0e2b);
  assert.equal(m.cycles, 289, "sum of T-states on the table-scan path");
  assert.deepEqual(m.calls, [0x116b, 0x11b0], "116b then 11b0; no table match -> no 11e0");
  assert.equal(m.mem.read8(0x4304), 0x10, "(ix+0x04) = (ix+0x09)+(ix+0x19) target Y");
  assert.equal(m.mem.read8(0x4303), 0x01, "(ix+0x03) bumped once at entry");
  assert.equal(m.regs.a, 0x1a, "A after add a,0x19 in the one loop pass");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0e2b.js
//   find: mem.write8(R(0x04), regs.a);  (the 0e37 store)
//   repl: (drop it -- (ix+0x04) never written)
//   expect: FAIL ((ix+0x04) stays 0x00 instead of 0x10; caught by the (ix+0x04) assert)
test("loc_0e2b: the contract catches a dropped (ix+0x04) target store", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    const R = (d) => (regs.ix + d) & 0xffff;
    regs.incMem8(mem, R(0x03)); m.step(0x0e2e, 23);
    m.push16(0x0e31); m.step(0x116b, 17); m.call(0x116b);
    regs.a = mem.read8(R(0x09)); m.step(0x0e34, 19);
    regs.add(mem.read8(R(0x19))); m.step(0x0e37, 19);
    m.step(0x0e3a, 19); // MUTANT: dropped ld (ix+0x04),a
    regs.add(0x07); m.step(0x0e3c, 7);
    regs.cp(0x0e); m.step(0x0e3e, 7);
    m.step(0x0e40, 7); // jr c not taken
    regs.a = mem.read8(R(0x03)); m.step(0x0e43, 19);
    regs.add(0x48); m.step(0x0e45, 7);
    m.step(0x0e47, 7); // jr c not taken
    regs.a = mem.read8(0x4200); m.step(0x0e4a, 13);
    regs.rrca(); m.step(0x0e4b, 4);
    m.step(0x0e4c, 5); // ret nc not taken
    m.push16(0x0e4f); m.step(0x11b0, 17); m.call(0x11b0);
    regs.a = mem.read8(0x422b); m.step(0x0e52, 13);
    regs.rrca(); m.step(0x0e53, 4);
    m.step(0x0e54, 5); // ret c not taken
    regs.hl = mem.read16(0x4213); m.step(0x0e57, 16);
    regs.a = mem.read8(R(0x03)); m.step(0x0e5a, 19);
    regs.cp(regs.h); m.step(0x0e5b, 4);
    m.step(0x0e5e, 10); // jp z not taken
    regs.add(0x19); m.step(0x0e60, 7);
    regs.l = regs.dec8(regs.l); m.step(0x0e61, 4);
    m.step(0x0e63, 7); // jr nz not taken
    m.ret();
  };
  const m = mk({ 0x116b: pop, 0x11b0: pop });
  seed(m);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4304), 0x10));
});
