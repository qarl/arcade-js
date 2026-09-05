// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0066 (Galaxian VBLANK-NMI handler, ROM 0x0066-0x00cd).
// Contract (main path, 0x401a==0, IN0 bit6==0): 3192 T = 509 fixed + 2683 for the 0x80-byte ldir
//   (6 pushes 74; xor 4; ld(0x7001)a 13; ld a,(nn) 13; and a 4; jp nz 10; 3x ld rr,nn 30; ldir 2683;
//    3x ld a,(nn)+ld(nn)a input-shuffle 13ea + 2x ld16 16ea; watchdog 13; bit 8; jp nz 10; ld hl 10;
//    dec(hl) 11; 6x call 17; ld hl 10; push 11; ld a,(nn) 13; rst 11).
// Effects: irq_enable latch cleared; OBJRAM shadow 0x4020->0x5800 (0x80 bytes) copied; raw IN0/1/2 latched
//   to 0x4010/11/12 with the previous frame shifted to 0x4013/14/15/16; 0x425f decremented; A=(0x4005)
//   loaded as the state index; calls the 6 per-frame subsystems then rst-28 dispatch (0x0028) with 0x00d8
//   (the NMI tail) pushed as the return addr, tail-continuing into 0x00d8.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0066 } from "../loc_0066.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.regs.sp = 0x4400;
  return m;
}

const SUBSYS = { 0x18ef: "mid", 0x1931: "mid", 0x197c: "mid", 0x16f5: "mid", 0x1898: "mid", 0x18c0: "mid" };
const wr = (m, addr, v) => { m.mem.workRam[addr & 0x3ff] = v; };
const rd = (m, addr) => m.mem.workRam[addr & 0x3ff];

function seed(m) {
  m.io.irqEnable = 1;               // pre-set so the ack write is observable
  m.io.in0 = 0x21; m.io.in1 = 0x42; // IN0 bit6 clear (no service reset); IN2 idles at 0x04
  wr(m, 0x4020, 0xab); wr(m, 0x409f, 0xcd); // OBJRAM-shadow endpoints
  wr(m, 0x4010, 0x77); wr(m, 0x4011, 0x88); // prev-frame raw IN0/IN1
  wr(m, 0x4013, 0x55); wr(m, 0x4015, 0x66); // older history cells
  wr(m, 0x425f, 0x05);              // frame-timer
  wr(m, 0x4005, 0x03);              // game-state index
}

function runMain(fn) {
  const m = mk({ ...SUBSYS, 0x0028: "mid", 0x00d8: "tail" });
  seed(m);
  const ret = fn(m);
  return { m, ret };
}

function checkMain({ m, ret }) {
  assert.equal(m.cycles, 3192, "T-state total (509 fixed + 2683 ldir)");
  assert.deepEqual(m.calls, [0x18ef, 0x1931, 0x197c, 0x16f5, 0x1898, 0x18c0, 0x0028, 0x00d8],
    "6 subsystems, rst-28 dispatch (0x0028), then the 0x00d8 NMI-tail continuation");
  assert.equal(ret, "TAIL", "the 0x00d8 tail continuation's result propagates out");
  assert.equal(m.io.irqEnable, 0, "ld (0x7001),a wrote A(=0) -> irq_enable acked");
  assert.equal(m.mem.objRam[0x00], 0xab, "ldir copied 0x4020 -> OBJRAM 0x5800");
  assert.equal(m.mem.objRam[0x7f], 0xcd, "ldir copied the full 0x80-byte block (0x409f -> 0x587f)");
  assert.equal(rd(m, 0x4010), 0x21, "raw IN0 latched to 0x4010");
  assert.equal(rd(m, 0x4011), 0x42, "raw IN1 latched to 0x4011");
  assert.equal(rd(m, 0x4012), 0x04, "raw IN2 latched to 0x4012");
  assert.equal(rd(m, 0x4013), 0x77, "history: prev 0x4010 shifted to 0x4013");
  assert.equal(rd(m, 0x4014), 0x88, "history: prev 0x4011 shifted to 0x4014");
  assert.equal(rd(m, 0x4015), 0x55, "history: prev 0x4013 shifted to 0x4015");
  assert.equal(rd(m, 0x4016), 0x66, "history: prev 0x4015 shifted to 0x4016");
  assert.equal(rd(m, 0x425f), 0x04, "dec (0x425f) frame-timer");
  assert.equal(m.regs.a, 0x03, "A = (0x4005) game-state index before the dispatch");
}

test("loc_0066: NMI handler latches inputs, copies OBJRAM, dispatches state; 3192 T", () => {
  checkMain(runMain(loc_0066));
});

test("loc_0066: 0x401a set diverts to loc_1bcd, then continues into the 0x00d8 NMI epilogue", () => {
  const m = mk({ 0x1bcd: "tail", 0x00d8: "tail" });
  m.regs.sp = 0x4400;
  wr(m, 0x401a, 0x01);
  const ret = loc_0066(m);
  assert.deepEqual(m.calls, [0x1bcd, 0x00d8],
    "jp nz,0x1bcd taken; loc_1bcd's handler rets into 0x00d8, which loc_0066 then runs to re-arm irq");
  assert.equal(ret, "TAIL", "the 0x00d8 epilogue's result propagates out");
  // 6 pushes (74) + xor(4) + ld(0x7001)a(13) + ld a,(0x401a)(13) + and a(4) + jp nz taken(10) = 118
  // (loc_1bcd + loc_00d8 are stubbed here, so they add no cycles).
  assert.equal(m.cycles, 118, "diverted before the ldir");
});

test("loc_0066: IN0 bit6 (service switch) forces a cold reset to 0x0000", () => {
  const m = mk({ ...SUBSYS, 0x0000: "tail" });
  m.regs.sp = 0x4400;
  m.io.in0 = 0x40; // bit6 set
  const ret = loc_0066(m);
  assert.deepEqual(m.calls, [0x0000], "jp nz,0x0000 taken -- no subsystem/dispatch calls run");
  assert.equal(ret, "TAIL");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0066.js
//   find: // The state routine returned to 0x00d8 (the NMI epilogue) -- continue there.\n  return m.call(0x00d8);
//   repl: // The state routine returned to 0x00d8 (the NMI epilogue) -- continue there.\n  return m.call(0x00e6);
//   expect: FAIL (calls tail == 0x00e6 != 0x00d8; the dispatch would return into a state body, not the epilogue)
//   verified-anchor: count == 1  (the sole "return m.call(0x00d8)" in loc_0066.js)
test("loc_0066: the contract catches a wrong post-dispatch continuation", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    m.push16(regs.af); m.step(0x0067, 11);
    m.push16(regs.bc); m.step(0x0068, 11);
    m.push16(regs.de); m.step(0x0069, 11);
    m.push16(regs.hl); m.step(0x006a, 11);
    m.push16(regs.ix); m.step(0x006c, 15);
    m.push16(regs.iy); m.step(0x006e, 15);
    regs.xor(regs.a); m.step(0x006f, 4);
    mem.write8(0x7001, regs.a, 10); m.step(0x0072, 13);
    regs.a = mem.read8(0x401a); m.step(0x0075, 13);
    regs.and(regs.a); m.step(0x0076, 4);
    m.step(0x0079, 10); // not taken
    regs.hl = 0x4020; m.step(0x007c, 10);
    regs.de = 0x5800; m.step(0x007f, 10);
    regs.bc = 0x0080; m.step(0x0082, 10);
    m.ldirAt(0x0082, 0x0084);
    regs.a = mem.read8(0x7800); m.step(0x0087, 13);
    regs.a = mem.read8(0x4015); m.step(0x008a, 13);
    mem.write8(0x4016, regs.a); m.step(0x008d, 13);
    regs.a = mem.read8(0x4013); m.step(0x0090, 13);
    mem.write8(0x4015, regs.a); m.step(0x0093, 13);
    regs.hl = mem.read16(0x4010); m.step(0x0096, 16);
    mem.write16(0x4013, regs.hl); m.step(0x0099, 16);
    regs.a = mem.read8(0x7000); m.step(0x009c, 13);
    mem.write8(0x4012, regs.a); m.step(0x009f, 13);
    regs.a = mem.read8(0x6800); m.step(0x00a2, 13);
    mem.write8(0x4011, regs.a); m.step(0x00a5, 13);
    regs.a = mem.read8(0x6000); m.step(0x00a8, 13);
    mem.write8(0x4010, regs.a); m.step(0x00ab, 13);
    regs.bit(6, regs.a); m.step(0x00ad, 8);
    m.step(0x00b0, 10); // not taken
    regs.hl = 0x425f; m.step(0x00b3, 10);
    regs.decMem8(mem, regs.hl); m.step(0x00b4, 11);
    m.push16(0x00b7); m.step(0x18ef, 17); m.call(0x18ef);
    m.push16(0x00ba); m.step(0x1931, 17); m.call(0x1931);
    m.push16(0x00bd); m.step(0x197c, 17); m.call(0x197c);
    m.push16(0x00c0); m.step(0x16f5, 17); m.call(0x16f5);
    m.push16(0x00c3); m.step(0x1898, 17); m.call(0x1898);
    m.push16(0x00c6); m.step(0x18c0, 17); m.call(0x18c0);
    regs.hl = 0x00d8; m.step(0x00c9, 10);
    m.push16(regs.hl); m.step(0x00ca, 11);
    regs.a = mem.read8(0x4005); m.step(0x00cd, 13);
    m.push16(0x00ce); m.step(0x0028, 11); m.call(0x0028);
    return m.call(0x00e6); // MUTANT: wrong continuation
  };
  const m = mk({ ...SUBSYS, 0x0028: "mid", 0x00e6: "tail" });
  seed(m);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls,
    [0x18ef, 0x1931, 0x197c, 0x16f5, 0x1898, 0x18c0, 0x0028, 0x00d8]));
});
