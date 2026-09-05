// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0e99 (ROM 0x0e99-0x0f06): object state handler slot 5. Contract on the entry init +
// loc_0ead "just advance" path ((ix+0x07)&0x70 != 0x70, 0x4200 bit0 clear -> jr nc into loc_0ed6):
// 163 T, no calls, (ix+0x03)=8, (ix+0x17) bumped, (ix+0x05)=0, (ix+0x02) bumped once, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0e99 } from "../loc_0e99.js";

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
  m.regs.ix = 0x4300;
  m.mem.write8(0x4307, 0x00); // (ix+0x07)&0x70 != 0x70 -> skip loc_0eda
  m.mem.write8(0x4200, 0x00); // bit0 clear -> jr nc,0x0ed6 taken (just advance)
}

function run(fn) {
  const m = mk({ 0x003c: pop });
  seed(m);
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_0e99: init + advance-only path -- 163 T, no calls, cells initialised, state bumped once", () => {
  const m = run(loc_0e99);
  assert.equal(m.cycles, 163, "sum of T-states on the advance-only path");
  assert.deepEqual(m.calls, [], "no prng branch, no call 0x003c");
  assert.equal(m.mem.read8(0x4303), 0x08, "(ix+0x03) <- 0x08");
  assert.equal(m.mem.read8(0x4317), 0x01, "(ix+0x17) counter bumped");
  assert.equal(m.mem.read8(0x4305), 0x00, "(ix+0x05) <- 0");
  assert.equal(m.mem.read8(0x4302), 0x01, "(ix+0x02) bumped once (loc_0ed6)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0e99.js
//   find: mem.write8(R(0x03), 0x08);  (the 0e99 init)
//   repl: (drop it -- (ix+0x03) never set)
//   expect: FAIL ((ix+0x03) stays 0x00 instead of 0x08; caught by the (ix+0x03) assert)
test("loc_0e99: the contract catches a dropped (ix+0x03)=8 init", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    const R = (d) => (regs.ix + d) & 0xffff;
    m.step(0x0e9d, 19); // MUTANT: dropped ld (ix+0x03),0x08
    regs.incMem8(mem, R(0x17)); m.step(0x0ea0, 23);
    mem.write8(R(0x05), 0x00); m.step(0x0ea4, 19);
    regs.a = mem.read8(R(0x07)); m.step(0x0ea7, 19);
    regs.and(0x70); m.step(0x0ea9, 7);
    regs.cp(0x70); m.step(0x0eab, 7);
    m.step(0x0ead, 7); // jr z not taken -> loc_0ead
    regs.a = mem.read8(0x4200); m.step(0x0eb0, 13);
    regs.rrca(); m.step(0x0eb1, 4);
    m.step(0x0ed6, 12); // jr nc,0x0ed6 taken
    regs.incMem8(mem, R(0x02)); m.step(0x0ed9, 23);
    m.ret();
  };
  const m = mk({});
  seed(m);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4303), 0x08));
});
