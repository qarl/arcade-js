// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1bed (Galaxian scan/verify loop, ROM 0x1BED-0x1C2B).
// Two contracts:
//   (a) whole page matches (single loop, L wraps to 0), (0x4008) decrements 1->0 so `ret nz` falls
//       through, the full state reset runs [call 0x003c, rst 0x10, latches/RAM/VRAM writes], then ret.
//       281 T; calls == [0x003c, 0x0010]; latch + RAM + VRAM effects; ret to caller.
//   (b) a (HL) mismatch takes `jr nz` and bails into loc_1c2c (19 T; calls == [0x1c2c]).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1bed } from "../loc_1bed.js";

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
  return m;
}
const wr = (m, a) => m.mem.workRam[a & 0x3ff];
const vr = (m, a) => m.mem.videoRam[a & 0x3ff];

// Full reset path: A==(0x40ff) so cp matches; L=0xff so one iteration wraps L to 0 and exits the loop;
// (0x4008)==1 so `dec (hl)` -> 0 and `ret nz` is NOT taken.
function setupFull(m) {
  m.regs.sp = 0x4380; m.push16(0xbeef); // caller return slot in work RAM
  m.regs.a = 0x50; m.regs.hl = 0x40ff;
  m.mem.workRam[0x0ff] = 0x50; // (0x40ff) == A -> match
  m.mem.workRam[0x008] = 0x01; // (0x4008) == 1 -> decrements to 0
}

function checkFull(m) {
  assert.equal(m.cycles, 281, "full reset path T-total");
  assert.deepEqual(m.calls, [0x003c, 0x0010], "call 0x003c then rst 0x10 (block-fill 0x0010)");
  assert.equal(wr(m, 0x4006), 1, "(0x4006)=1");
  assert.equal(wr(m, 0x401a), 1, "(0x401a)=1");
  assert.equal(wr(m, 0x4226), 1, "(0x4226)=1");
  assert.equal(wr(m, 0x425f), 1, "(0x425f)=1");
  assert.equal(wr(m, 0x4238), 1, "(0x4238)=1");
  assert.deepEqual(m.io.startLamp, [1, 1], "(0x6000)/(0x6001)=1 -> both start lamps");
  assert.equal(m.io.coinLock, 1, "(0x6002)=1 -> coin lock latch");
  assert.equal(vr(m, 0x5213), 0x1f, "(0x5213)=0x1f VRAM");
  assert.equal(vr(m, 0x51f3), 0x1b, "(0x51f3)=0x1b VRAM");
  assert.equal(m.pc, 0xbeef, "ret to caller");
}

test("loc_1bed: page matches -> full state reset + ret; 281 T", () => {
  const m = mk({ 0x003c: "pop", 0x0010: "pop" });
  setupFull(m);
  loc_1bed(m);
  checkFull(m);
});

test("loc_1bed: (HL) mismatch bails to loc_1c2c; 19 T", () => {
  const m = mk({ 0x1c2c: "tail" });
  m.regs.a = 0x50; m.regs.hl = 0x40ff;
  m.mem.workRam[0x0ff] = 0x99; // (0x40ff) != A -> jr nz taken
  const ret = loc_1bed(m);
  assert.equal(m.cycles, 19, "cp (hl) 7 + jr nz taken 12");
  assert.deepEqual(m.calls, [0x1c2c], "bail target loc_1c2c");
  assert.equal(ret, "TAIL", "tail-transfer result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1bed.js
//   find: mem.write8(0x6002, regs.a, 10);
//   repl: mem.write8(0x6003, regs.a, 10);
//   expect: FAIL  (writes coin_count_0 instead of coin_lock; io.coinLock stays 0 -- caught by checkFull)
//   verified-anchor: count == 1  (the sole 0x6002 store in loc_1bed.js)
test("loc_1bed: the contract catches a wrong latch target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.cp(mem.read8(regs.hl)); m.step(0x1bee, 7);
      if (regs.fNZ) { m.step(0x1c2c, 12); return m.call(0x1c2c); }
      m.step(0x1bf0, 7);
      regs.add(0x2f); m.step(0x1bf2, 7);
      regs.l = regs.inc8(regs.l); m.step(0x1bf3, 4);
      if (regs.fNZ) { m.step(0x1bed, 10); continue; }
      m.step(0x1bf6, 10); break;
    }
    regs.a = mem.read8(0x7800); m.step(0x1bf9, 13);
    m.push16(0x1bfc); m.step(0x003c, 17); m.call(0x003c);
    regs.hl = 0x4008; m.step(0x1bff, 10);
    regs.decMem8(mem, regs.hl); m.step(0x1c00, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1c01, 5);
    regs.xor(regs.a); m.step(0x1c02, 4);
    regs.hl = 0x5800; m.step(0x1c05, 10);
    regs.b = regs.a; m.step(0x1c06, 4);
    m.push16(0x1c07); m.step(0x0010, 11); m.call(0x0010);
    regs.a = 0x01; m.step(0x1c09, 7);
    mem.write8(0x4006, regs.a); m.step(0x1c0c, 13);
    mem.write8(0x401a, regs.a); m.step(0x1c0f, 13);
    mem.write8(0x6000, regs.a, 10); m.step(0x1c12, 13);
    mem.write8(0x6001, regs.a, 10); m.step(0x1c15, 13);
    mem.write8(0x6003, regs.a, 10); m.step(0x1c18, 13); // MUTANT: wrong latch (0x6003 not 0x6002)
    mem.write8(0x4226, regs.a); m.step(0x1c1b, 13);
    mem.write8(0x425f, regs.a); m.step(0x1c1e, 13);
    mem.write8(0x4238, regs.a); m.step(0x1c21, 13);
    regs.a = 0x1f; m.step(0x1c23, 7);
    mem.write8(0x5213, regs.a); m.step(0x1c26, 13);
    regs.a = 0x1b; m.step(0x1c28, 7);
    mem.write8(0x51f3, regs.a); m.step(0x1c2b, 13);
    m.ret();
  };
  const m = mk({ 0x003c: "pop", 0x0010: "pop" });
  setupFull(m);
  mutant(m);
  assert.throws(() => checkFull(m));
});
