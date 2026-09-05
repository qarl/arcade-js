// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0d06 (ROM 0x0d06-0x0d70): object state-0 init. Reads a 2-byte record from the table
// at 0x1dd1 (indexed by direction bits) into (ix+0x16)/(ix+0x18), then the shared tail seeds motion
// counters and advances the state. Exercised: direction 0 (not the 0x0e variant), (ix+6) clear arm.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0d06 } from "../loc_0d06.js";

function mk(stubs = {}, rom = new Uint8Array(0x4000)) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(rom, routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const popret = (mm) => { mm.pop16(); };

test("loc_0d06: state-0 init, direction 0, (ix+6) clear -> (ix+5)=0x0c; 385 T", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x1dd1] = 0x11; rom[0x1dd2] = 0x22; // spawn record for index 0
  const m = mk({ 0x1147: popret, 0x08f2: popret }, rom);
  m.regs.ix = 0x42b0;
  m.mem.write8(0x42b0 + 0x07, 0x00); // direction byte
  m.mem.write8(0x42b0 + 0x06, 0x00); // (ix+6) bit0 clear
  m.mem.write8(0x42b0 + 0x02, 0x00); // state
  m.push16(0x9999);
  loc_0d06(m);
  assert.equal(m.cycles, 385, "sum of all instr T-states on this path");
  assert.deepEqual(m.calls, [0x1147, 0x08f2], "the two setup calls, in order");
  assert.equal(m.mem.read8(0x41c2), 0x01, "(0x41c2) <- 1");
  assert.equal(m.mem.read8(0x42b0 + 0x16), 0x11, "(ix+0x16) <- table byte 0");
  assert.equal(m.mem.read8(0x42b0 + 0x18), 0x22, "(ix+0x18) <- table byte 1");
  assert.equal(m.mem.read8(0x42b0 + 0x0f), 0x00, "(ix+0x0f) <- 0 (non-top direction)");
  assert.equal(m.mem.read8(0x42b0 + 0x10), 0x03, "(ix+0x10) step counter");
  assert.equal(m.mem.read8(0x42b0 + 0x11), 0x0c, "(ix+0x11) leg counter");
  assert.equal(m.mem.read8(0x42b0 + 0x02), 0x01, "(ix+2) advanced 0 -> 1");
  assert.equal(m.mem.read8(0x42b0 + 0x05), 0x0c, "(ix+5) = +0x0c ((ix+6) clear arm)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0d06.js  (shared tail)
//   find: regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);   repl: drop it
//   expect: FAIL -- (ix+2) stays 0, never advances to state 1; caught by the (ix+2) assert.
test("loc_0d06: the contract catches a dropped state advance", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x1dd1] = 0x11; rom[0x1dd2] = 0x22;
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8((regs.ix + 0x17) & 0xffff, 0x00); m.step(0x0d0a, 19);
    regs.a = 0x01; m.step(0x0d0c, 7);
    mem.write8(0x41c2, regs.a); m.step(0x0d0f, 13);
    m.push16(0x0d12); m.step(0x1147, 17); m.call(0x1147);
    regs.e = mem.read8((regs.ix + 0x07) & 0xffff); m.step(0x0d15, 19);
    regs.d = 0x01; m.step(0x0d17, 7);
    m.push16(0x0d1a); m.step(0x08f2, 17); m.call(0x08f2);
    regs.a = regs.e; m.step(0x0d1b, 4);
    regs.and(0x70); m.step(0x0d1d, 7);
    regs.hl = 0x1dd1; m.step(0x0d20, 10);
    regs.rrca(); m.step(0x0d21, 4);
    regs.rrca(); m.step(0x0d22, 4);
    regs.rrca(); m.step(0x0d23, 4);
    regs.e = regs.a; m.step(0x0d24, 4);
    regs.d = 0x00; m.step(0x0d26, 7);
    regs.addHl(regs.de); m.step(0x0d27, 11);
    regs.a = mem.read8(regs.hl); m.step(0x0d28, 7);
    mem.write8((regs.ix + 0x16) & 0xffff, regs.a); m.step(0x0d2b, 19);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x0d2c, 6);
    regs.a = mem.read8(regs.hl); m.step(0x0d2d, 7);
    mem.write8((regs.ix + 0x18) & 0xffff, regs.a); m.step(0x0d30, 19);
    regs.a = regs.e; m.step(0x0d31, 4);
    regs.cp(0x0e); m.step(0x0d33, 7);
    m.step(0x0d35, 7);
    mem.write8((regs.ix + 0x0f) & 0xffff, 0x00); m.step(0x0d39, 19);
    mem.write8((regs.ix + 0x10) & 0xffff, 0x03); m.step(0x0d3d, 19);
    mem.write8((regs.ix + 0x11) & 0xffff, 0x0c); m.step(0x0d41, 19);
    mem.write8((regs.ix + 0x13) & 0xffff, 0x00); m.step(0x0d45, 19);
    m.step(0x0d48, 23); // MUTANT: dropped inc (ix+2)
    regs.bit(0, mem.read8((regs.ix + 0x06) & 0xffff)); m.step(0x0d4c, 20);
    m.step(0x0d4e, 7);
    mem.write8((regs.ix + 0x05) & 0xffff, 0x0c); m.step(0x0d52, 19);
    m.ret();
  };
  const m = mk({ 0x1147: popret, 0x08f2: popret }, rom);
  m.regs.ix = 0x42b0;
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x42b0 + 0x02), 0x01));
});
