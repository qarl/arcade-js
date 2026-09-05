// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_21a6 (ROM 0x21a6-0x21f7): BCD score update. Index A=0 path with an all-equal running
// total: rst 08 -> loc_2290 (DE=0x40a2) -> 3-byte BCD add of the table@0x22d0 -> compare vs (0x40aa) equal -> ret.
// Contract: 566 T, calls [0x0008, 0x2290, 0x2256] (call nc,0x229c skipped), 0x40a2 <- 0x05, ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_21a6 } from "../loc_21a6.js";
import { loc_0008 } from "../loc_0008.js";

const rst08 = (mm) => { mm.pc = mm.pop16(); };                      // (0x4007) bit0 clear: normal return to 0x21a8
const call2290 = (mm) => { mm.pop16(); mm.regs.de = 0x40a2; };      // seeds the score-buffer pointer
const call2256 = (mm) => { mm.pop16(); };
const call229c = (mm) => { mm.pop16(); };                           // not reached in this path

function build() {
  const rom = new Uint8Array(0x4000);
  rom[0x22d0] = 0x05; // BCD increment: +5 into the low byte
  const routines = new Map([
    [0x0008, rst08], [0x2290, call2290], [0x2256, call2256], [0x229c, call229c],
  ]);
  const m = new Machine(rom, routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.mem.write8(0x40ac, 0xff); // high-nibble check: cp (0x40ac) sets carry -> call nc NOT taken
  m.mem.write8(0x40a8, 0x05); // stored total low byte == new total -> compare stays equal
  m.push16(0x9999);           // caller return for the final ret
  m.regs.a = 0x00;            // index 0
  return m;
}

function run(fn) {
  const m = build();
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, pc: m.pc, score: m.mem.read8(0x40a2) };
}

function checkSpec(res) {
  assert.equal(res.cycles, 566, "T-state total for the index-0 equal-total path");
  assert.deepEqual(res.calls, [0x0008, 0x2290, 0x2256], "rst 08, loc_2290, loc_2256 (call nc,0x229c skipped)");
  assert.equal(res.score, 0x05, "BCD +5 landed in the low score byte 0x40a2");
  assert.equal(res.pc, 0x9999, "ret to caller after an equal total");
}

test("loc_21a6: BCD add + equal-total compare returns to caller; 566 T", () => {
  checkSpec(run(loc_21a6));
});

test("loc_21a6: (0x4007) bit0 set -> rst 08 double-returns, whole score update skipped", () => {
  const rom = new Uint8Array(0x4000);
  rom[0x22d0] = 0x05;
  // real loc_0008 so the actual double-return (inc sp;inc sp;ret) runs
  const routines = new Map([
    [0x0008, loc_0008], [0x2290, call2290], [0x2256, call2256], [0x229c, call229c],
  ]);
  const m = new Machine(rom, routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.mem.write8(0x4007, 0x01); // bit0 set -> loc_0008 discards the rst return + rets to loc_21a6's caller
  m.mem.write8(0x40a2, 0x00);
  m.push16(0x9999);           // loc_21a6's own return; the double-return lands here
  m.regs.a = 0x00;
  loc_21a6(m);
  assert.deepEqual(m.calls, [0x0008], "only the rst 08 ran; the BCD score update is skipped");
  assert.equal(m.mem.read8(0x40a2), 0x00, "no BCD add on the double-return skip path");
  assert.equal(m.pc, 0x9999, "double-return landed at loc_21a6's caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_21a6.js
//   find: regs.hl = 0x22d0;\n  m.step(0x21b4, 10); // ld hl,0x22d0 -- BCD-increment table (ROM)
//   repl: regs.hl = 0x22e0;\n  m.step(0x21b4, 10); // ld hl,0x22e0
//   expect: FAIL (wrong table base -> +0 not +5 -> 0x40a2 stays 0, and the total is now below stored)
test("loc_21a6: the contract catches a wrong increment-table base", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.c = regs.a; m.step(0x21a7, 4);
    m.push16(0x21a8); m.step(0x0008, 11); m.call(0x0008);
    if (m.pc !== 0x21a8) return;
    m.push16(0x21ab); m.step(0x2290, 17); m.call(0x2290);
    regs.a = regs.c; m.step(0x21ac, 4);
    regs.add(regs.c); m.step(0x21ad, 4);
    regs.add(regs.c); m.step(0x21ae, 4);
    regs.c = regs.a; m.step(0x21af, 4);
    regs.b = 0x00; m.step(0x21b1, 7);
    regs.hl = 0x22e0; m.step(0x21b4, 10); // MUTANT: wrong table base
    regs.addHl(regs.bc); m.step(0x21b5, 11);
    regs.and(regs.a); m.step(0x21b6, 4);
    regs.b = 0x03; m.step(0x21b8, 7);
    for (;;) {
      regs.a = mem.read8(regs.de); m.step(0x21b9, 7);
      regs.adc(mem.read8(regs.hl)); m.step(0x21ba, 7);
      regs.daa(); m.step(0x21bb, 4);
      mem.write8(regs.de, regs.a); m.step(0x21bc, 7);
      regs.de = (regs.de + 1) & 0xffff; m.step(0x21bd, 6);
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x21be, 6);
      if (regs.djnz() !== 0) { m.step(0x21b8, 13); continue; }
      m.step(0x21c0, 8); break;
    }
    regs.de = (regs.de - 1) & 0xffff; m.step(0x21c1, 6);
    m.push16(regs.de); m.step(0x21c2, 11);
    regs.de = (regs.de - 1) & 0xffff; m.step(0x21c3, 6);
    regs.h = regs.a; m.step(0x21c4, 4);
    regs.a = mem.read8(regs.de); m.step(0x21c5, 7);
    regs.l = regs.a; m.step(0x21c6, 4);
    regs.addHl(regs.hl); m.step(0x21c7, 11);
    regs.addHl(regs.hl); m.step(0x21c8, 11);
    regs.addHl(regs.hl); m.step(0x21c9, 11);
    regs.addHl(regs.hl); m.step(0x21ca, 11);
    regs.a = regs.h; m.step(0x21cb, 4);
    regs.hl = 0x40ac; m.step(0x21ce, 10);
    regs.cp(mem.read8(regs.hl)); m.step(0x21cf, 7);
    if (regs.fNC) { m.push16(0x21d2); m.step(0x229c, 17); m.call(0x229c); }
    else { m.step(0x21d2, 10); }
    regs.de = (regs.de + 1) & 0xffff; m.step(0x21d3, 6);
    regs.a = mem.read8(0x400d); m.step(0x21d6, 13);
    m.push16(0x21d9); m.step(0x2256, 17); m.call(0x2256);
    regs.de = m.pop16(); m.step(0x21da, 10);
    regs.hl = 0x40aa; m.step(0x21dd, 10);
    regs.b = 0x03; m.step(0x21df, 7);
    for (;;) {
      regs.a = mem.read8(regs.de); m.step(0x21e0, 7);
      regs.cp(mem.read8(regs.hl)); m.step(0x21e1, 7);
      if (regs.fC) { m.ret(11); return; }
      m.step(0x21e2, 5);
      if (regs.fNZ) { m.step(0x21e9, 12); break; }
      m.step(0x21e4, 7);
      regs.de = (regs.de - 1) & 0xffff; m.step(0x21e5, 6);
      regs.hl = (regs.hl - 1) & 0xffff; m.step(0x21e6, 6);
      if (regs.djnz() !== 0) { m.step(0x21df, 13); continue; }
      m.step(0x21e8, 8); m.ret(); return;
    }
    m.push16(0x21ec); m.step(0x2290, 17); m.call(0x2290);
    regs.hl = 0x40a8; m.step(0x21ef, 10);
    regs.b = 0x03; m.step(0x21f1, 7);
    for (;;) {
      regs.a = mem.read8(regs.de); m.step(0x21f2, 7);
      mem.write8(regs.hl, regs.a); m.step(0x21f3, 7);
      regs.de = (regs.de + 1) & 0xffff; m.step(0x21f4, 6);
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x21f5, 6);
      if (regs.djnz() !== 0) { m.step(0x21f1, 13); continue; }
      m.step(0x21f7, 8); break;
    }
    regs.de = (regs.de - 1) & 0xffff; m.step(0x21f8, 6);
    return m.call(0x21f8);
  };
  const m = build();
  m.routines.set(0x21f8, () => "TAIL");
  mutant(m);
  assert.throws(() => checkSpec({ cycles: m.cycles, calls: m.calls, pc: m.pc, score: m.mem.read8(0x40a2) }));
});
