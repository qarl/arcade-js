// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1218 (ROM 0x1218-0x1226): RNG scaler. call 0x0048; call 0x003c; A&=0x1f; A+=C; A+=6;
// ret p, else A=0x7f. Contract (positive path): 63 T, calls [0x48,0x3c], A = (rand&0x1f)+C+6.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1218 } from "../loc_1218.js";

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
// callee stubs: pop the pushed return address; 0x003c also delivers the "random" byte in A.
const pop = (mm) => { mm.pop16(); };
const randByte = (val) => (mm) => { mm.pop16(); mm.regs.a = val; };

test("loc_1218: positive path -> A=(rand&0x1f)+C+6; 63 T; calls [0x48,0x3c]", () => {
  const m = mk({ 0x0048: pop, 0x003c: randByte(0x30) });
  m.regs.c = 0x20;
  m.push16(0x9999);
  loc_1218(m);
  assert.equal(m.regs.a, 0x36, "(0x30 & 0x1f=0x10) + 0x20 + 6 = 0x36");
  assert.equal(m.cycles, 63, "17+17+7+4+7+11");
  assert.deepEqual(m.calls, [0x0048, 0x003c]);
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_1218: overflow past 0x7f -> clamp to 0x7f; 74 T", () => {
  const m = mk({ 0x0048: pop, 0x003c: randByte(0x1f) });
  m.regs.c = 0x70;
  m.push16(0x9999);
  loc_1218(m);
  assert.equal(m.regs.a, 0x7f, "0x1f+0x70+6=0x95 (S set) -> clamp 0x7f");
  assert.equal(m.cycles, 74, "17+17+7+4+7+5+7+10");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1218.js
//   find: regs.add(0x06);
//   repl: regs.add(0x00);
//   expect: FAIL -- positive-path A would be 0x30 not 0x36 (caught by the A assert)
test("loc_1218: contract catches a dropped `add a,6`", () => {
  const m = mk({ 0x0048: pop, 0x003c: randByte(0x30) });
  m.regs.c = 0x20;
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs } = mm;
    mm.push16(0x121b); mm.step(0x0048, 17); mm.call(0x0048);
    mm.push16(0x121e); mm.step(0x003c, 17); mm.call(0x003c);
    regs.and(0x1f); mm.step(0x1220, 7);
    regs.add(regs.c); mm.step(0x1221, 4);
    regs.add(0x00); mm.step(0x1223, 7); // MUTANT: dropped the +6
    if (regs.fP) { mm.ret(11); return; }
    mm.step(0x1224, 5); regs.a = 0x7f; mm.step(0x1226, 7); mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x36));
});
