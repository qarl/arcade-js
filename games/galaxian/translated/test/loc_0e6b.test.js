// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0e6b (ROM 0x0e6b-0x0e98): object state handler slot 4. Contract on the in-range,
// positive-(ix+0x19), no-carry path (falls into loc_0e8c): 188 T, calls [0x116b], (ix+0x03)=new pos,
// (ix+0x04)=new Y, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0e6b } from "../loc_0e6b.js";

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
const pop = (mm) => { mm.pop16(); };

function seed(m) {
  const { mem } = m;
  m.regs.ix = 0x4300;
  mem.write8(0x425f, 0x00); // frame parity 0 -> step = 1
  mem.write8(0x4303, 0x10); // (ix+0x03) pos
  mem.write8(0x4319, 0x10); // (ix+0x19) positive -> jp m NOT taken
  mem.write8(0x4309, 0x05); // (ix+0x09)
}

function run(fn) {
  const m = mk({ 0x116b: pop });
  seed(m);
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_0e6b: in-range store-Y path -- 188 T, calls [0x116b], (ix+0x03)=0x11, (ix+0x04)=0x15", () => {
  const m = run(loc_0e6b);
  assert.equal(m.cycles, 188, "sum of T-states on the store-Y path");
  assert.deepEqual(m.calls, [0x116b], "only 0x116b; no state-advance branch");
  assert.equal(m.mem.read8(0x4303), 0x11, "(ix+0x03) = pos + step(1)");
  assert.equal(m.mem.read8(0x4304), 0x15, "(ix+0x04) = (ix+0x19)+(ix+0x09)");
  assert.equal(m.regs.a, 0x15, "A = new Y");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0e6b.js
//   find: mem.write8(R(0x03), regs.a);  (the 0e74 store)
//   repl: (drop it -- (ix+0x03) never updated)
//   expect: FAIL ((ix+0x03) stays 0x10 instead of 0x11; caught by the (ix+0x03) assert)
test("loc_0e6b: the contract catches a dropped (ix+0x03) position store", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    const R = (d) => (regs.ix + d) & 0xffff;
    regs.a = mem.read8(0x425f); m.step(0x0e6e, 13);
    regs.and(0x01); m.step(0x0e70, 7);
    regs.a = regs.inc8(regs.a); m.step(0x0e71, 4);
    regs.add(mem.read8(R(0x03))); m.step(0x0e74, 19);
    m.step(0x0e77, 19); // MUTANT: dropped ld (ix+0x03),a
    regs.sub(0x06); m.step(0x0e79, 7);
    regs.cp(0x03); m.step(0x0e7b, 7);
    m.step(0x0e7d, 7); // jr c not taken
    m.push16(0x0e80); m.step(0x116b, 17); m.call(0x116b);
    regs.a = mem.read8(R(0x19)); m.step(0x0e83, 19);
    regs.and(regs.a); m.step(0x0e84, 4);
    m.step(0x0e87, 10); // jp m not taken
    regs.add(mem.read8(R(0x09))); m.step(0x0e8a, 19);
    m.step(0x0e8c, 7); // jr c not taken -> loc_0e8c
    mem.write8(R(0x04), regs.a); m.step(0x0e8f, 19);
    m.ret();
  };
  const m = mk({ 0x116b: pop });
  seed(m);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4303), 0x11));
});
