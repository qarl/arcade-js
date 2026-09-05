// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_215f (ROM 0x215f-0x2186): A==0 -> loc_219b; A==1 -> loc_2187; else compute A and
// stamp four VRAM cells (0x51da/0x51dc/0x521a/0x521c) via 0x2585 (last = tail). Straight path 161 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_215f } from "../loc_215f.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(0x9999);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_215f: A>=2 stamps four VRAM cells via 0x2585; 161 T", () => {
  const seen = [];
  const m = mk({ 0x2585: (mm) => seen.push({ hl: mm.regs.hl, a: mm.regs.a }) });
  m.regs.a = 0x04;
  loc_215f(m);
  assert.equal(m.cycles, 161, "straight-line arithmetic + 3 calls + jp");
  assert.deepEqual(m.calls, [0x2585, 0x2585, 0x2585, 0x2585], "four draws");
  assert.deepEqual(seen.map((s) => s.hl), [0x51da, 0x51dc, 0x521a, 0x521c], "cell addresses");
  assert.equal(seen[0].a, 0xd0, "A = (((4-2)<<4) cpl & 0x30) + 0xc0");
});

test("loc_215f: A==0 tail-jumps to loc_219b; A==1 to loc_2187", () => {
  const m0 = mk({ 0x219b: () => {} });
  m0.regs.a = 0x00;
  loc_215f(m0);
  assert.equal(m0.cycles, 16, "and a + jr z taken");
  assert.deepEqual(m0.calls, [0x219b]);

  const m1 = mk({ 0x2187: () => {} });
  m1.regs.a = 0x01;
  loc_215f(m1);
  assert.equal(m1.cycles, 27, "and a + jr z not + dec a + jr z taken");
  assert.deepEqual(m1.calls, [0x2187]);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_215f.js
//   find: regs.and(0x30);
//   repl: regs.and(0x70);
//   expect: FAIL (A = 0x10 instead of 0xD0 at the first 0x2585 call)
test("loc_215f: the contract catches a wrong index mask", () => {
  const seen = [];
  const mutant = (m) => {
    const { regs } = m;
    regs.and(regs.a); m.step(0x2160, 4);
    m.step(0x2162, 7);
    regs.a = regs.dec8(regs.a); m.step(0x2163, 4);
    m.step(0x2165, 7);
    regs.a = regs.dec8(regs.a); m.step(0x2166, 4);
    regs.add(regs.a); m.step(0x2167, 4);
    regs.add(regs.a); m.step(0x2168, 4);
    regs.add(regs.a); m.step(0x2169, 4);
    regs.add(regs.a); m.step(0x216a, 4);
    regs.cpl(); m.step(0x216b, 4);
    regs.and(0x70); m.step(0x216d, 7); // MUTANT
    regs.add(0xc0); m.step(0x216f, 7);
    regs.hl = 0x51da; m.step(0x2172, 10);
    m.push16(0x2175); m.step(0x2585, 17); m.call(0x2585);
  };
  const m = mk({ 0x2585: (mm) => seen.push(mm.regs.a) });
  m.regs.a = 0x04;
  mutant(m);
  assert.throws(() => assert.equal(seen[0], 0xd0));
});
