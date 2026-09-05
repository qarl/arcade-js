// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_13e1 (ROM 0x13e1-0x140b): sets direction flag (0x4215) from HL=(0x420e), DE=(0x4210).
// Path here: H bit7 clear (jr z,0x13f7), E-L < 0x1c -> (0x4215)=1, ret. Contract: 108 T, no calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_13e1 } from "../loc_13e1.js";

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

test("loc_13e1: H positive, E-L<0x1c -> (0x4215)=1; 108 T, no rng call", () => {
  const m = mk({ 0x003c: (mm) => { mm.pop16(); } });
  m.mem.write8(0x420e, 0x10); m.mem.write8(0x420f, 0x00); // HL=0x0010 (h bit7 clear)
  m.mem.write8(0x4210, 0x20); m.mem.write8(0x4211, 0x00); // DE=0x0020
  m.push16(0x9999);
  loc_13e1(m);
  assert.equal(m.cycles, 108, "sum of all instr T-states on this path");
  assert.deepEqual(m.calls, [], "close gap -> no 0x003c rng call");
  assert.equal(m.mem.read8(0x4215), 0x01, "(0x4215) direction flag = 1");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_13e1.js
//   find: regs.a = 0x01;  m.step(0x13ff, 7);   (inside the jr-z / not-far arm)
//   repl: drop it (A stays E-L = 0x10)
//   expect: FAIL -- (0x4215) gets 0x10 instead of 0x01; caught by the (0x4215) assert.
test("loc_13e1: the contract catches a wrong stored direction value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = mem.read16(0x420e); m.step(0x13e4, 16);
    regs.de = mem.read16(0x4210); m.step(0x13e8, 20);
    regs.bit(7, regs.h); m.step(0x13ea, 8);
    m.step(0x13f7, 12); // jr z taken
    regs.a = regs.e; m.step(0x13f8, 4);
    regs.sub(regs.l); m.step(0x13f9, 4);
    regs.cp(0x1c); m.step(0x13fb, 7);
    m.step(0x13fd, 7); // jr nc not taken
    // MUTANT: dropped `regs.a = 0x01`, A stays 0x10 from the sub
    m.step(0x13ff, 7);
    mem.write8(0x4215, regs.a); m.step(0x1402, 13);
    m.ret();
  };
  const m = mk();
  m.mem.write8(0x420e, 0x10); m.mem.write8(0x4210, 0x20);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4215), 0x01));
});
