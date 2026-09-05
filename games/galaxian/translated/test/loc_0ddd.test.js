// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0ddd (ROM 0x0ddd-0x0e0e): compute a clamped target X from (ix+0x04) vs 0x4202, then
// tail into loc_0df6 with the result in A. Contract for ref=0x40, actorX=0xC0 (actor RIGHT of ref): the
// positive branch yields A=0x50, 96 T, calls [0x0df6].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0ddd } from "../loc_0ddd.js";

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

test("loc_0ddd: right-of-ref positive branch -> A=0x50, delegate loc_0df6; 96 T", () => {
  const m = mk({ 0x0df6: tail("DF6") });
  m.mem.write8(0x4202, 0x40); // reference X
  m.mem.write8(0x4004, 0xc0); // (ix+0x04) actor X
  const ret = loc_0ddd(m);
  // sub=0x80 (nc) -> rra=0x40 -> +0x10=0x50 -> cp 0x30 nc (skip low clamp) -> cp 0x70 c (in band)
  assert.equal(m.regs.a, 0x50, "half the gap, biased, within 0x30..0x70");
  assert.deepEqual(m.calls, [0x0df6], "hands the target to loc_0df6");
  assert.equal(ret, "DF6");
  assert.equal(m.cycles, 96, "13+4+19+4+7+4+7+7+12+7+12");
});

test("loc_0ddd: left-of-ref (carry) branch clamps into 0x90..0xd0", () => {
  const m = mk({ 0x0df6: tail("DF6") });
  m.mem.write8(0x4202, 0xc0); // reference X
  m.mem.write8(0x4004, 0x40); // actor X (left of ref -> sub borrows)
  loc_0ddd(m);
  // sub=0x40-0xc0=0x80 (carry) -> rra brings 1 into bit7 = 0xc0 -> -0x10=0xb0 -> cp 0xd0 c (skip hi clamp)
  //   -> cp 0x90 nc (in band) -> A=0xb0
  assert.equal(m.regs.a, 0xb0, "carry branch band 0x90..0xd0");
  assert.deepEqual(m.calls, [0x0df6]);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0ddd.js
//   find (positive branch): regs.add(0x10);
//   repl: (drop it) -> A stays 0x40 instead of 0x50
//   expect: FAIL (delivered A differs; caught by the A==0x50 assert)
test("loc_0ddd: contract catches a dropped `add 0x10` bias", () => {
  const m = mk({ 0x0df6: tail("DF6") });
  m.mem.write8(0x4202, 0x40);
  m.mem.write8(0x4004, 0xc0);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = mem.read8(0x4202); mm.step(0x0de0, 13);
    regs.b = regs.a; mm.step(0x0de1, 4);
    regs.a = mem.read8((regs.ix + 0x04) & 0xffff); mm.step(0x0de4, 19);
    regs.sub(regs.b); mm.step(0x0de5, 4);
    mm.step(0x0de7, 7); // jr c not taken (nc)
    regs.rra(); mm.step(0x0de8, 4);
    mm.step(0x0dea, 7); // MUTANT: dropped `add 0x10`
    regs.cp(0x30); mm.step(0x0dec, 7);
    mm.step(0x0df0, 12); // jr nc taken (A=0x40 >= 0x30)
    regs.cp(0x70); mm.step(0x0df2, 7);
    mm.step(0x0df6, 12); return mm.call(0x0df6); // jr c taken (0x40 < 0x70)
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x50));
});
