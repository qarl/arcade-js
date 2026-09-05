// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0550 (ROM 0x0550-0x0582): sub-state-0 field init. Zero start_lamp latches, four
// rst-0x10 fills (stubbed here), (0x425f)=0, (0x4226)=1, inc (0x400a), (0x4009)=0x20, (0x400b/0c)=0x5000.
// Contract 240 T; calls [0x0010 x4].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0550 } from "../loc_0550.js";

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
const rst10 = (mm) => { mm.pop16(); }; // loc_0010 block-fill stub

function seed(m) {
  m.io.startLamp = [1, 1];       // so the 0x6000/0x6001 clears are observable
  m.mem.write8(0x425f, 0xff);
  m.mem.write8(0x400a, 0x02);    // inc (0x400a) -> 0x03
}

test("loc_0550: field init writes; 240 T, four rst-0x10 fills", () => {
  const m = mk({ 0x0010: rst10 });
  seed(m);
  m.push16(0x9999);
  loc_0550(m);
  assert.equal(m.cycles, 240, "sum of loc_0550's own instr T-states (fills stubbed)");
  assert.deepEqual(m.calls, [0x0010, 0x0010, 0x0010, 0x0010], "four rst 0x10 block-fills");
  assert.deepEqual(m.io.startLamp, [0, 0], "start_lamp[0]/[1] latches cleared (io, NOT mem.read8)");
  assert.equal(m.mem.read8(0x425f), 0x00, "(0x425f) <- 0");
  assert.equal(m.mem.read8(0x4226), 0x01, "(0x4226) <- 1");
  assert.equal(m.mem.read8(0x400a), 0x03, "inc (0x400a): 2 -> 3");
  assert.equal(m.mem.read8(0x4009), 0x20, "(0x4009) <- 0x20");
  assert.equal(m.mem.read16(0x400b), 0x5000, "(0x400b/0c) <- 0x5000");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0550.js
//   find: regs.incMem8(mem, regs.hl);
//   repl: (drop it -- (0x400a) keeps its old value)
//   expect: FAIL ((0x400a) stays 2; caught by the inc assert)
test("loc_0550: the contract catches a dropped `inc (0x400a)`", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4100; m.step(0x0553, 10);
    regs.b = 0x80; m.step(0x0555, 7);
    regs.xor(regs.a); m.step(0x0556, 4);
    mem.write8(0x6000, regs.a, 10); m.step(0x0559, 13);
    mem.write8(0x6001, regs.a, 10); m.step(0x055c, 13);
    m.push16(0x055d); m.step(0x0010, 11); m.call(0x0010);
    mem.write8(0x425f, regs.a); m.step(0x0560, 13);
    regs.hl = 0x4200; m.step(0x0563, 10);
    regs.b = 0x17; m.step(0x0565, 7);
    m.push16(0x0566); m.step(0x0010, 11); m.call(0x0010);
    regs.l = regs.inc8(regs.l); m.step(0x0567, 4);
    regs.b = 0x18; m.step(0x0569, 7);
    m.push16(0x056a); m.step(0x0010, 11); m.call(0x0010);
    regs.hl = 0x4260; m.step(0x056d, 10);
    regs.b = 0x46; m.step(0x056f, 7);
    m.push16(0x0570); m.step(0x0010, 11); m.call(0x0010);
    regs.a = 0x01; m.step(0x0572, 7);
    mem.write8(0x4226, regs.a); m.step(0x0575, 13);
    regs.hl = 0x400a; m.step(0x0578, 10);
    m.step(0x0579, 11); // MUTANT: dropped inc (0x400a)
    regs.l = regs.dec8(regs.l); m.step(0x057a, 4);
    mem.write8(regs.hl, 0x20); m.step(0x057c, 10);
    regs.hl = 0x5000; m.step(0x057f, 10);
    mem.write16(0x400b, regs.hl); m.step(0x0582, 16);
    m.ret();
  };
  const m = mk({ 0x0010: rst10 });
  seed(m);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x400a), 0x03));
});
