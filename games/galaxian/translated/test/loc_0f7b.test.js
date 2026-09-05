// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0f7b (ROM 0x0f7b-0x0f86): call 0x0ddd, then seed (ix+0x18)=3 and (ix+0x10)=0x64; ret.
// Contract: 65 T, calls [0x0ddd], (ix+0x18)=0x03, (ix+0x10)=0x64.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0f7b } from "../loc_0f7b.js";

const IX = 0x4100;

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = IX;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// 0x0ddd stub: pop the call's pushed return (loc_0ddd rets cleanly).
const setup0ddd = (mm) => { mm.pop16(); };

test("loc_0f7b: call 0x0ddd + seed timers, 65 T", () => {
  const m = mk({ 0x0ddd: setup0ddd });
  m.push16(0x9999);
  loc_0f7b(m);
  assert.equal(m.cycles, 65, "17 + 19 + 19 + 10");
  assert.deepEqual(m.calls, [0x0ddd], "one call to 0x0ddd");
  assert.equal(m.mem.read8(IX + 0x18), 0x03, "(ix+0x18) <- 3");
  assert.equal(m.mem.read8(IX + 0x10), 0x64, "(ix+0x10) <- 0x64");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0f7b.js
//   find: mem.write8((regs.ix + 0x10) & 0xffff, 0x64);
//   repl: mem.write8((regs.ix + 0x10) & 0xffff, 0x00);
//   expect: FAIL — timer seed wrong (0x00 instead of 0x64)
test("loc_0f7b: contract catches a wrong (ix+0x10) timer seed", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(0x0f7e); m.step(0x0ddd, 17); m.call(0x0ddd);
    mem.write8((regs.ix + 0x18) & 0xffff, 0x03); m.step(0x0f82, 19);
    mem.write8((regs.ix + 0x10) & 0xffff, 0x00); m.step(0x0f86, 19); // MUTANT: 0x00 not 0x64
    m.ret();
  };
  const m = mk({ 0x0ddd: setup0ddd });
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(IX + 0x10), 0x64));
});
