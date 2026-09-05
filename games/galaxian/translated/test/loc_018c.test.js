// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_018c (ROM 0x018c-0x01bd): sub-state 0 setup. Enqueues DE=0x0701 then DE=0x0600 via
// 0x08f2, sets stars_enable (0x7004)=1 (+ two unmapped 0x7000 writes), advances (0x400a), clears
// (0x4019/0x400d/0x400e/0x4006), seeds (0x4008)=0x1060; ret. Contract: 226 T, calls [0x08f2,0x08f2].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_018c } from "../loc_018c.js";

function mk(seenDe) {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.routines.set(0x08f2, (mm) => { seenDe.push(mm.regs.de); mm.pop16(); });
  return m;
}

test("loc_018c: two enqueues + latch setup + work-RAM clear; 226 T", () => {
  const seenDe = [];
  const m = mk(seenDe);
  m.mem.write8(0x400a, 0x05); // sub-state index pre-bump
  m.push16(0x9999); // caller return for the routine's own ret
  loc_018c(m);
  assert.equal(m.cycles, 226, "sum of all instr T-states");
  assert.deepEqual(m.calls, [0x08f2, 0x08f2], "two command-queue enqueues");
  assert.deepEqual(seenDe, [0x0701, 0x0600], "enqueued words, in order");
  assert.equal(m.io.starsEnable, 1, "0x7004 stars_enable_w D0 <- 1 (io latch, not mem.read8)");
  assert.equal(m.mem.unmappedWrites, 2, "0x7002 and 0x7003 are unmapped in the 0x7000 block");
  assert.equal(m.mem.read8(0x4007), 0x01, "(0x4007) <- 1");
  assert.equal(m.mem.read8(0x400a), 0x06, "(0x400a) advanced 0x05 -> 0x06");
  assert.equal(m.mem.read8(0x4019), 0x00);
  assert.equal(m.mem.read8(0x400d), 0x00);
  assert.equal(m.mem.read8(0x400e), 0x00);
  assert.equal(m.mem.read8(0x4006), 0x00);
  assert.equal(m.mem.read16(0x4008), 0x1060, "(0x4008) pointer word <- 0x1060");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_018c.js
//   find: regs.hl = 0x1060;
//   repl: regs.hl = 0x1050;
//   expect: FAIL (wrong pointer word, caught by the (0x4008) assert)
test("loc_018c: the contract catches a wrong 0x4008 pointer word", () => {
  const seenDe = [];
  const m = mk(seenDe);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.de = 0x0701; mm.step(0x018f, 10);
    mm.push16(0x0192); mm.step(0x08f2, 17); mm.call(0x08f2);
    regs.de = 0x0600; mm.step(0x0195, 10);
    mm.push16(0x0198); mm.step(0x08f2, 17); mm.call(0x08f2);
    regs.a = 0x01; mm.step(0x019a, 7);
    mem.write8(0x4007, regs.a); mm.step(0x019d, 13);
    mem.write8(0x7004, regs.a, 10); mm.step(0x01a0, 13);
    mem.write8(0x7002, regs.a, 10); mm.step(0x01a3, 13);
    mem.write8(0x7003, regs.a, 10); mm.step(0x01a6, 13);
    regs.hl = 0x400a; mm.step(0x01a9, 10);
    regs.incMem8(mem, regs.hl); mm.step(0x01aa, 11);
    regs.xor(regs.a); mm.step(0x01ab, 4);
    mem.write8(0x4019, regs.a); mm.step(0x01ae, 13);
    mem.write8(0x400d, regs.a); mm.step(0x01b1, 13);
    mem.write8(0x400e, regs.a); mm.step(0x01b4, 13);
    mem.write8(0x4006, regs.a); mm.step(0x01b7, 13);
    regs.hl = 0x1050; mm.step(0x01ba, 10); // MUTANT
    mem.write16(0x4008, regs.hl); mm.step(0x01bd, 16);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read16(0x4008), 0x1060));
});
