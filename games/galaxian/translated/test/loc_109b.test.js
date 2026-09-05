// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_109b (ROM 0x109b-0x10c1): per-object step. n=(~(ix+0x07))&3; writes n+1 at
// (ix+0x16), (n+1)<<4+0x8c at (ix+0x03), timer (ix+0x10)=0x18, advances state (ix+0x02), (ix+0x0f)=0;
// then (ix+0x0f)=0x18 ONLY when n==0. Two paths: n==0 -> 202 T (ret nz falls through), n!=0 -> 179 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_109b } from "../loc_109b.js";

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
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];

test("loc_109b: n==0 path (ix+7=0x03) -> (ix+0x0f)=0x18; 202 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4047, 0x03); // (ix+0x07): ~0x03 & 3 = 0 -> n=0
  wr(m, 0x4042, 0x02); // (ix+0x02) state
  loc_109b(m);

  assert.equal(m.cycles, 202, "full fall-through (ret nz not taken)");
  assert.deepEqual(m.calls, [], "no subroutine calls");
  assert.equal(rd(m, 0x4056), 0x01, "(ix+0x16) <- n+1 = 1");
  assert.equal(rd(m, 0x4043), 0x9c, "(ix+0x03) <- (1<<4)+0x8c = 0x9c");
  assert.equal(rd(m, 0x4050), 0x18, "timer (ix+0x10) <- 0x18");
  assert.equal(rd(m, 0x4042), 0x03, "state (ix+0x02) advanced 2->3");
  assert.equal(rd(m, 0x404f), 0x18, "n==0 -> (ix+0x0f) <- 0x18");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_109b: n!=0 path (ix+7=0x00) -> (ix+0x0f) stays 0; 179 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4047, 0x00); // ~0x00 & 3 = 3 -> n=3
  wr(m, 0x4042, 0x02);
  loc_109b(m);

  assert.equal(m.cycles, 179, "ret nz taken");
  assert.equal(rd(m, 0x4056), 0x04, "(ix+0x16) <- n+1 = 4");
  assert.equal(rd(m, 0x4043), 0xcc, "(ix+0x03) <- (4<<4)+0x8c = 0xcc");
  assert.equal(rd(m, 0x404f), 0x00, "n!=0 -> (ix+0x0f) left at 0");
  assert.equal(m.pc, 0x9999);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_109b.js
//   find: the fourth `regs.rlca(); m.step(0x10aa, 4);`
//   repl: (drop it) -- only 3 rlca, (ix+0x03) becomes (n+1)<<3 + 0x8c
//   expect: FAIL (0x4043 = 0x94 not 0x9c on the n==0 path)
test("loc_109b: contract catches a dropped 4th rlca (wrong (ix+0x03))", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(regs.ix + 0x07); m.step(0x109e, 19);
    regs.cpl(); m.step(0x109f, 4);
    regs.and(0x03); m.step(0x10a1, 7);
    regs.b = regs.a; m.step(0x10a2, 4);
    regs.a = regs.inc8(regs.a); m.step(0x10a3, 4);
    mem.write8(regs.ix + 0x16, regs.a); m.step(0x10a6, 19);
    regs.rlca(); m.step(0x10a7, 4);
    regs.rlca(); m.step(0x10a8, 4);
    regs.rlca(); m.step(0x10a9, 4);
    m.step(0x10aa, 4); // MUTANT: dropped 4th rlca
    regs.add(0x8c); m.step(0x10ac, 7);
    mem.write8(regs.ix + 0x03, regs.a); m.step(0x10af, 19);
    mem.write8(regs.ix + 0x10, 0x18); m.step(0x10b3, 19);
    regs.incMem8(mem, regs.ix + 0x02); m.step(0x10b6, 23);
    mem.write8(regs.ix + 0x0f, 0x00); m.step(0x10ba, 19);
    regs.a = regs.b; m.step(0x10bb, 4);
    regs.and(regs.a); m.step(0x10bc, 4);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x10bd, 5);
    mem.write8(regs.ix + 0x0f, 0x18); m.step(0x10c1, 19);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  m.regs.ix = 0x4040;
  wr(m, 0x4047, 0x03);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x4043), 0x9c));
});
