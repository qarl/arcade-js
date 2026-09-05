// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0008 (RST 08 vector, ROM 0x0008-0x000F):
//   0008  3a 07 40  ld a,(0x4007)
//   000b  0f        rrca            ; carry <- bit0
//   000c  d0        ret nc          ; bit0=0 -> normal return
//   000d  33        inc sp          ; bit0=1 -> skip the caller's return slot
//   000e  33        inc sp
//   000f  c9        ret             ; return two levels up
// Contract: bit0=0 path = 28 T (13+4+11), SP+2, pc=caller ret; bit0=1 path = 44 T
// (13+4+5+6+6+10), SP+4, pc=the return TWO levels up.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0008 } from "../loc_0008.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

// bit0 clear -> `ret nc` taken (normal single return)
function runClear(fn) {
  const m = mk();
  m.regs.sp = 0x4300;
  m.mem.write8(0x4300, 0x34);
  m.mem.write8(0x4301, 0x12); // caller return = 0x1234
  m.mem.write8(0x4007, 0x02); // bit0 = 0
  fn(m);
  return { cycles: m.cycles, sp: m.regs.sp, pc: m.pc };
}

// bit0 set -> double-return (skip the caller's own return slot)
function runSet(fn) {
  const m = mk();
  m.regs.sp = 0x4300;
  m.mem.write8(0x4300, 0xff); m.mem.write8(0x4301, 0xff); // caller's own return (skipped)
  m.mem.write8(0x4302, 0x78); m.mem.write8(0x4303, 0x56); // return two levels up = 0x5678
  m.mem.write8(0x4007, 0x01); // bit0 = 1
  fn(m);
  return { cycles: m.cycles, sp: m.regs.sp, pc: m.pc };
}

function checkClear(r) {
  assert.equal(r.cycles, 28, "bit0=0: 13+4+11");
  assert.equal(r.sp, 0x4302, "bit0=0: one return, SP+2");
  assert.equal(r.pc, 0x1234, "bit0=0: returns to the caller");
}

function checkSet(r) {
  assert.equal(r.cycles, 44, "bit0=1: 13+4+5+6+6+10");
  assert.equal(r.sp, 0x4304, "bit0=1: SP+4 (skip + return)");
  assert.equal(r.pc, 0x5678, "bit0=1: returns two levels up");
}

test("loc_0008: bit0=0 returns normally (28 T)", () => {
  checkClear(runClear(loc_0008));
});

test("loc_0008: bit0=1 skips the caller's return slot (44 T)", () => {
  checkSet(runSet(loc_0008));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0008.js
//   find: regs.sp = (regs.sp + 1) & 0xffff;\n  m.step(0x000f, 6); // inc sp
//   repl: m.step(0x000f, 6); // inc sp  (drops the SECOND inc sp)
//   expect: FAIL  (only one slot skipped -> pc = 0x78ff, SP = 0x4303)
//   verified-anchor: count == 1  (the second `inc sp` before 0x000f)
test("loc_0008: the contract catches a dropped second inc sp", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4007);
    m.step(0x000b, 13);
    regs.rrca();
    m.step(0x000c, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x000d, 5);
    regs.sp = (regs.sp + 1) & 0xffff;
    m.step(0x000e, 6);
    m.step(0x000f, 6); // MUTANT: only one inc sp
    m.ret();
  };
  assert.throws(() => checkSet(runSet(mutant)));
});
