// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0dd1 (ROM 0x0dd1-0x0ddc): inc (ix+0x03); if ((ix+0x07)&0x70)==0x60 tail-jump 0x0e20,
// else fall into 0x0ddd. Contract: with kind byte 0x6f -> 68 T, calls [0x0e20], (ix+0x03) bumped.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0dd1 } from "../loc_0dd1.js";

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

test("loc_0dd1: kind 0x60 masks to 0x60 -> tail-jump 0x0e20; 68 T; (ix+0x03) bumped", () => {
  const m = mk({ 0x0e20: tail("E20") });
  m.mem.write8(0x4003, 0x10); // (ix+0x03)
  m.mem.write8(0x4007, 0x6f); // (ix+0x07) -- masks with 0x70 to 0x60
  const ret = loc_0dd1(m);
  assert.equal(m.cycles, 68, "23+19+7+7+12 (jr z taken)");
  assert.deepEqual(m.calls, [0x0e20], "kind 0x60 delegates to loc_0e20");
  assert.equal(ret, "E20", "tail-jump result propagates");
  assert.equal(m.mem.read8(0x4003), 0x11, "inc (ix+0x03)");
});

test("loc_0dd1: other kind falls through to loc_0ddd", () => {
  const m = mk({ 0x0ddd: tail("DDD") });
  m.mem.write8(0x4007, 0x20); // &0x70 = 0x20 != 0x60
  const ret = loc_0dd1(m);
  assert.deepEqual(m.calls, [0x0ddd], "non-0x60 kind falls into loc_0ddd");
  assert.equal(ret, "DDD");
  assert.equal(m.cycles, 63, "23+19+7+7+7 (jr z not taken)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0dd1.js
//   find: regs.and(0x70);
//   repl: (drop it -- A keeps the raw kind byte)
//   expect: FAIL (0x6f != 0x60 so branch not taken -> calls [0x0ddd] not [0x0e20])
test("loc_0dd1: contract catches a dropped `and 0x70` mask", () => {
  const m = mk({ 0x0ddd: tail("DDD"), 0x0e20: tail("E20") });
  m.mem.write8(0x4007, 0x6f);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.incMem8(mem, (regs.ix + 0x03) & 0xffff); mm.step(0x0dd4, 23);
    regs.a = mem.read8((regs.ix + 0x07) & 0xffff); mm.step(0x0dd7, 19);
    mm.step(0x0dd9, 7); // MUTANT: dropped `and 0x70`
    regs.cp(0x60); mm.step(0x0ddb, 7);
    if (regs.fZ) { mm.step(0x0e20, 12); return mm.call(0x0e20); }
    mm.step(0x0ddd, 7); return mm.call(0x0ddd);
  };
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x0e20]));
});
