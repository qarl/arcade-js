// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0e20 (ROM 0x0e20-0x0e2a): bit0 of 0x42d0 selects the target source. Clear -> delegate
// loc_0ddd (relative select); set -> load fixed target 0x42e9 into A and tail to loc_0df6.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0e20 } from "../loc_0e20.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4000;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const tail = (name) => () => name;

test("loc_0e20: 0x42d0 bit0 set -> fixed target 0x42e9 -> loc_0df6; 49 T", () => {
  const m = mk({ 0x0df6: tail("DF6") });
  m.mem.write8(0x42d0, 0x01); // bit0 set
  m.mem.write8(0x42e9, 0x99); // fixed target X
  const ret = loc_0e20(m);
  assert.equal(m.regs.a, 0x99, "loaded fixed target from 0x42e9");
  assert.deepEqual(m.calls, [0x0df6], "hands the fixed target to loc_0df6");
  assert.equal(ret, "DF6");
  assert.equal(m.cycles, 49, "13+4+7+13+12");
});

test("loc_0e20: 0x42d0 bit0 clear -> relative select via loc_0ddd; 29 T", () => {
  const m = mk({ 0x0ddd: tail("DDD") });
  m.mem.write8(0x42d0, 0x00); // bit0 clear
  const ret = loc_0e20(m);
  assert.deepEqual(m.calls, [0x0ddd], "bit0 clear delegates to loc_0ddd");
  assert.equal(ret, "DDD");
  assert.equal(m.cycles, 29, "13+4+12 (jr nc taken)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0e20.js
//   find: regs.rrca();
//   repl: (drop it) -> carry stays clear so bit0-set input wrongly takes the jr nc to loc_0ddd
//   expect: FAIL (calls [0x0ddd] not [0x0df6])
test("loc_0e20: contract catches a dropped `rrca` (bit0 test lost)", () => {
  const m = mk({ 0x0ddd: tail("DDD"), 0x0df6: tail("DF6") });
  m.mem.write8(0x42d0, 0x01);
  m.mem.write8(0x42e9, 0x99);
  m.regs.f = 0x00; // carry clear on entry, as at a real call site
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = mem.read8(0x42d0); mm.step(0x0e23, 13);
    mm.step(0x0e24, 4); // MUTANT: dropped `rrca` -- carry unchanged (clear)
    if (regs.fNC) { mm.step(0x0ddd, 12); return mm.call(0x0ddd); }
    mm.step(0x0e26, 7);
    regs.a = mem.read8(0x42e9); mm.step(0x0e29, 13);
    mm.step(0x0df6, 12); return mm.call(0x0df6);
  };
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x0df6]));
});
