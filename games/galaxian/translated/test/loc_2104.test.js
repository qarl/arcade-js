// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2104 (ROM 0x2104-0x211c): clamp B=0x80 & ret when B>=0x70 (inline 210a); else
// B&=0x0f, C from compare vs (0x425f&0x0f), pop AF, fall through to loc_211d.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2104 } from "../loc_2104.js";

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

test("loc_2104: B>=0x70 clamps B=0x80 and returns; 56 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.regs.b = 0x80;
  loc_2104(m);
  assert.equal(m.cycles, 56, "11+4+7+7+7+10+10");
  assert.equal(m.regs.b, 0x80, "clamped");
  assert.deepEqual(m.calls, [], "no delegation on the clamp path");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_2104: B<0x70 masks B, falls through to loc_211d; 98 T", () => {
  const m = mk({ 0x211d: () => {} });
  m.push16(0x9999);
  m.mem.write8(0x425f, 0x08);
  m.regs.b = 0x25;
  loc_2104(m);
  assert.equal(m.cycles, 98, "jr c taken, jr nc taken (no dec c)");
  assert.equal(m.regs.b, 0x05, "B &= 0x0f");
  assert.equal(m.regs.c, 0x00, "(0x425f&0x0f)=8 >= B=5 -> C stays 0");
  assert.deepEqual(m.calls, [0x211d], "falls through into loc_211d");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2104.js
//   find: regs.b = 0x80;
//   repl: regs.b = 0x00;
//   expect: FAIL (clamp path leaves B=0x00, caught by the B==0x80 assert)
test("loc_2104: the contract catches a wrong clamp value", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(regs.af); m.step(0x2105, 11);
    regs.a = regs.b; m.step(0x2106, 4);
    regs.cp(0x70); m.step(0x2108, 7);
    m.step(0x210a, 7);
    regs.b = 0x00; m.step(0x210c, 7); // MUTANT
    regs.af = m.pop16(); m.step(0x210d, 10);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  m.regs.b = 0x80;
  mutant(m);
  assert.throws(() => assert.equal(m.regs.b, 0x80));
});
