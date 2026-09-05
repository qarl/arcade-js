// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_18c0 (Galaxian text/message scroller step, ROM 0x18c0-0x18e6):
//   gated by 0x40b0 bit0 (rrca -> carry, ret nc when clear); *(0x40b1)&7 nonzero -> tail loc_18e8;
//   char *(0x40b3)==0x3f -> tail loc_18e7; else advance source, sub 0x30 -> tile, store via *(0x40b5),
//   bump that pointer -0x20, store back, fall through to loc_18e7.
// Paths: idle 28 T (ret nc); countdown-active 64 T (tail 0x18e8); terminator 105 T (tail 0x18e7);
// render 189 T (fall-through -> m.call 0x18e7), source++, tile stored, dest -0x20.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_18c0 } from "../loc_18c0.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

// enable=0x40b0, ctrl byte at 0x4200 (pointer at 0x40b1), char at 0x4210 (pointer at 0x40b3),
// dest VRAM pointer 0x5100 (at 0x40b5).
function setup(m, { enable, ctrl, char }) {
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x00); m.mem.write8(0x4401, 0x20); // ret -> 0x2000
  m.mem.write8(0x40b0, enable);
  m.mem.write16(0x40b1, 0x4200); m.mem.write8(0x4200, ctrl);
  m.mem.write16(0x40b3, 0x4210); m.mem.write8(0x4210, char);
  m.mem.write16(0x40b5, 0x5100);
}

test("loc_18c0: bit0 clear -> ret nc (idle); 28 T", () => {
  const m = mk();
  setup(m, { enable: 0x00, ctrl: 0x00, char: 0x00 });
  loc_18c0(m);
  assert.equal(m.cycles, 28, "13+4+11 (ret nc taken)");
  assert.deepEqual(m.calls, [], "no dispatch");
  assert.equal(m.pc, 0x2000, "ret to caller");
});

test("loc_18c0: countdown byte low3 nonzero -> tail loc_18e8; 64 T", () => {
  const m = mk({ 0x18e8: () => "E8" });
  setup(m, { enable: 0x01, ctrl: 0x03, char: 0x00 });
  const ret = loc_18c0(m);
  assert.equal(m.cycles, 64, "13+4+5+16+7+7+12");
  assert.deepEqual(m.calls, [0x18e8], "tail into the countdown tick");
  assert.equal(ret, "E8", "tail callee result propagates");
});

test("loc_18c0: char==0x3f terminator -> tail loc_18e7; 105 T", () => {
  const m = mk({ 0x18e7: () => "E7" });
  setup(m, { enable: 0x01, ctrl: 0x08, char: 0x3f });
  const ret = loc_18c0(m);
  assert.equal(m.cycles, 105, "through jr z taken");
  assert.deepEqual(m.calls, [0x18e7], "tail into loc_18e7 (swap+dec)");
  assert.equal(ret, "E7", "tail callee result propagates");
});

function runRender(fn) {
  const m = mk({ 0x18e7: () => "E7" });
  setup(m, { enable: 0x01, ctrl: 0x08, char: 0x3a }); // 0x3a != 0x3f; tile = 0x3a-0x30 = 0x0a
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls, ret,
    src: m.mem.read16(0x40b3), tile: m.mem.read8(0x5100), dst: m.mem.read16(0x40b5),
  };
}

function checkRender(r) {
  assert.equal(r.cycles, 189, "full body up to the fall-through");
  assert.deepEqual(r.calls, [0x18e7], "falls through into loc_18e7");
  assert.equal(r.ret, "E7", "fall-through callee result propagates");
  assert.equal(r.src, 0x4211, "source pointer advanced by 1");
  assert.equal(r.tile, 0x0a, "char 0x3a - 0x30 stored to VRAM 0x5100");
  assert.equal(r.dst, 0x50e0, "dest pointer bumped up one column (-0x20)");
}

test("loc_18c0: render path stores a tile and advances both pointers; 189 T", () => {
  checkRender(runRender(loc_18c0));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_18c0.js
//   find: regs.bc = 0xffe0;
//   repl: regs.bc = 0x0020;   (scroll the wrong way)
//   expect: FAIL  (dest pointer becomes 0x5120 not 0x50e0 -- caught by dst == 0x50e0)
//   verified-anchor: count == 1  (the sole `regs.bc = 0xffe0` in loc_18c0.js)
test("loc_18c0: the contract catches a wrong column stride", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x40b0); m.step(0x18c3, 13);
    regs.rrca(); m.step(0x18c4, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x18c5, 5);
    regs.hl = mem.read16(0x40b1); m.step(0x18c8, 16);
    regs.a = mem.read8(regs.hl); m.step(0x18c9, 7);
    regs.and(0x07); m.step(0x18cb, 7);
    if (regs.fNZ) { m.step(0x18e8, 12); return m.call(0x18e8); }
    m.step(0x18cd, 7);
    regs.exDeHl(); m.step(0x18ce, 4);
    regs.hl = mem.read16(0x40b3); m.step(0x18d1, 16);
    regs.a = mem.read8(regs.hl); m.step(0x18d2, 7);
    regs.cp(0x3f); m.step(0x18d4, 7);
    if (regs.fZ) { m.step(0x18e7, 12); return m.call(0x18e7); }
    m.step(0x18d6, 7);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x18d7, 6);
    mem.write16(0x40b3, regs.hl); m.step(0x18da, 16);
    regs.sub(0x30); m.step(0x18dc, 7);
    regs.hl = mem.read16(0x40b5); m.step(0x18df, 16);
    mem.write8(regs.hl, regs.a); m.step(0x18e0, 7);
    regs.bc = 0x0020; // MUTANT: wrong stride direction
    m.step(0x18e3, 10);
    regs.addHl(regs.bc); m.step(0x18e4, 11);
    mem.write16(0x40b5, regs.hl); m.step(0x18e7, 16);
    return m.call(0x18e7);
  };
  assert.throws(() => checkRender(runRender(mutant)));
});
