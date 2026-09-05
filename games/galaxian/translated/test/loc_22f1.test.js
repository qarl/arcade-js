// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_22f1 (ROM 0x22f1-0x235b): message painter. Blank-fill path (A=0x80 -> add a,a sets
// carry): walks the record table @0x235c, then writes 0x40 into VRAM cells (stepping -0x20) until the 0x3f
// terminator. Contract: 223 T for a one-char string, VRAM dest cell <- 0x40, ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_22f1 } from "../loc_22f1.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  // record-ptr table @0x235c -> record @0x2400 = { dest word 0x53f0, text 0x41, 0x3f }
  m.mem.rom[0x235c] = 0x00; m.mem.rom[0x235d] = 0x24;
  m.mem.rom[0x2400] = 0xf0; m.mem.rom[0x2401] = 0x53;
  m.mem.rom[0x2402] = 0x41; m.mem.rom[0x2403] = 0x3f;
  m.push16(0x9999);
  return m;
}

test("loc_22f1: blank-fill writes 0x40 into the record's VRAM cell; 223 T", () => {
  const m = mk();
  m.regs.a = 0x80;
  loc_22f1(m);
  assert.equal(m.cycles, 223, "setup walk + one blank iter + terminator");
  assert.equal(m.mem.read8(0x53f0), 0x40, "VRAM dest cell <- 0x40 (blank tile)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_22f1.js
//   find: mem.write8(regs.hl, 0x40);   (the blank-fill store)
//   repl: mem.write8(regs.hl, 0x41);
//   expect: FAIL (VRAM cell gets 0x41; caught by the read8(0x53f0)==0x40 assert)
test("loc_22f1: the contract catches a wrong blank-fill value", () => {
  const m = mk();
  m.regs.a = 0x80;
  // mutant: replay the blank path with the wrong fill byte
  const { regs, mem } = m;
  regs.hl = 0x235c; m.step(0x22f4, 10);
  regs.add(regs.a); m.step(0x22f5, 4);
  m.push16(regs.af); m.step(0x22f6, 11);
  regs.and(0x3f); m.step(0x22f8, 7);
  regs.e = regs.a; m.step(0x22f9, 4);
  regs.d = 0x00; m.step(0x22fb, 7);
  regs.addHl(regs.de); m.step(0x22fc, 11);
  regs.e = mem.read8(regs.hl); m.step(0x22fd, 7);
  regs.hl = (regs.hl + 1) & 0xffff; m.step(0x22fe, 6);
  regs.d = mem.read8(regs.hl); m.step(0x22ff, 7);
  regs.exDeHl(); m.step(0x2300, 4);
  regs.e = mem.read8(regs.hl); m.step(0x2301, 7);
  regs.hl = (regs.hl + 1) & 0xffff; m.step(0x2302, 6);
  regs.d = mem.read8(regs.hl); m.step(0x2303, 7);
  regs.hl = (regs.hl + 1) & 0xffff; m.step(0x2304, 6);
  regs.exDeHl(); m.step(0x2305, 4);
  regs.bc = 0xffe0; m.step(0x2308, 10);
  regs.af = m.pop16(); m.step(0x2309, 10);
  m.step(0x2319, 12);
  regs.a = mem.read8(regs.de); m.step(0x231a, 7);
  regs.cp(0x3f); m.step(0x231c, 7);
  m.step(0x231d, 5);
  mem.write8(regs.hl, 0x41); m.step(0x231f, 10); // MUTANT
  assert.throws(() => assert.equal(m.mem.read8(0x53f0), 0x40));
});
