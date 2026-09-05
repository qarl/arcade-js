// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1886 (ROM 0x1886-0x1897):
//   1886  23        inc hl
//   1887  7e        ld a,(hl)
//   1888  a7        and a
//   1889  c8        ret z          ; counter (HL) == 0 -> idle
//   188a  35        dec (hl)
//   188b  23        inc hl
//   188c  7e        ld a,(hl)
//   188d  c6 04     add a,0x04
//   188f  77        ld (hl),a
//   1890  32 c1 41  ld (0x41c1),a
//   1893  af        xor a
//   1894  32 c0 41  ld (0x41c0),a  ; clear request
//   1897  c9        ret
// Contract A (idle): 28 T (6+7+4+11), no writes, ret.
// Contract B (active): 100 T; counter--, param+=4 mirrored to 0x41c1, 0x41c0=0, A=0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1886 } from "../loc_1886.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  return m;
}

function checkActive(m) {
  assert.equal(m.cycles, 100, "T-state total, active path");
  assert.equal(m.mem.read8(0x4201), 4, "counter decremented 5 -> 4");
  assert.equal(m.mem.read8(0x4202), 0x14, "param 0x10 + 4 stored back");
  assert.equal(m.mem.read8(0x41c1), 0x14, "0x41c1 mirrors param+4");
  assert.equal(m.mem.read8(0x41c0), 0, "0x41c0 cleared");
  assert.equal(m.regs.a, 0, "xor a left A=0");
  assert.equal(m.pc, 0x1234, "ret popped the caller's return");
}

test("loc_1886: counter idle -> ret z; 28 T, no writes", () => {
  const m = mk();
  m.regs.hl = 0x4200;
  m.mem.write8(0x4201, 0); // counter at HL+1 == 0
  m.mem.write8(0x41c0, 0xaa); m.mem.write8(0x41c1, 0xbb);
  loc_1886(m);
  assert.equal(m.cycles, 28, "6 + 7 + 4 + 11");
  assert.equal(m.mem.read8(0x41c0), 0xaa, "0x41c0 untouched on the idle path");
  assert.equal(m.mem.read8(0x41c1), 0xbb, "0x41c1 untouched on the idle path");
  assert.equal(m.pc, 0x1234, "ret z returned to the caller");
});

test("loc_1886: counter active -> step param, 100 T", () => {
  const m = mk();
  m.regs.hl = 0x4200;
  m.mem.write8(0x4201, 5); // counter
  m.mem.write8(0x4202, 0x10); // param
  loc_1886(m);
  checkActive(m);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1886.js
//   find: regs.add(0x04);
//   repl: regs.add(0x05);
//   expect: FAIL (param becomes +5, caught by the 0x14 param / 0x41c1 asserts)
test("loc_1886: the contract catches a wrong param increment", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1887, 6);
    regs.a = mem.read8(regs.hl); m.step(0x1888, 7);
    regs.and(regs.a); m.step(0x1889, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x188a, 5);
    regs.decMem8(mem, regs.hl); m.step(0x188b, 11);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x188c, 6);
    regs.a = mem.read8(regs.hl); m.step(0x188d, 7);
    regs.add(0x05); m.step(0x188f, 7); // MUTANT
    mem.write8(regs.hl, regs.a); m.step(0x1890, 7);
    mem.write8(0x41c1, regs.a); m.step(0x1893, 13);
    regs.xor(regs.a); m.step(0x1894, 4);
    mem.write8(0x41c0, regs.a); m.step(0x1897, 13);
    m.ret();
  };
  const m = mk();
  m.regs.hl = 0x4200;
  m.mem.write8(0x4201, 5); m.mem.write8(0x4202, 0x10);
  mutant(m);
  assert.throws(() => checkActive(m));
});
