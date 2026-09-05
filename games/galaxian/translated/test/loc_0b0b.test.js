// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0b0b (ROM 0x0b0b-0x0b76): position->grid hit check. Guards on (0x4208) bit0; bands
// the (0x4209) position into row B (subtract 0x1e then -7/-5 loop); loc_0b25 forms a column offset from
// (0x420a)-(0x420e), windows it, indexes grid 0x4100 by ((col&0xf0)+B)>>4; if that cell bit0 set it clears
// the cell, calls 0x08f2 (d=1,e=cell-lo), stashes D to (0x420b)/(0x42b1), zeros (0x42b2), copies (0x4209/a)
// to (0x42b3/4), then tail-jps 0x08f2. Contract: hit path calls [0x08f2,0x08f2] and the tail result flows out.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0b0b } from "../loc_0b0b.js";

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
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };
const rd = (m, a) => m.mem.workRam[a & 0x3ff];
// 0x08f2 stub: mark D (observed via (0x420b)/(0x42b1)) and return a marker so the tail-jp result propagates.
const stub08f2 = (mm) => { mm.regs.d = 0x77; return "T08F2"; };

function hitScene(m) {
  wr(m, 0x4208, 0x01); // bit0 set -> not ret z
  wr(m, 0x4209, 0x40); // position in [0x1e,0x68)
  wr(m, 0x420a, 0x05); // column ref
  wr(m, 0x420e, 0x00); // column base
  for (let i = 0; i < 0x100; i++) wr(m, 0x4100 + i, 0x01); // grid all active
}

test("loc_0b0b: (0x4208) bit0 clear -> ret z; 33 T", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4208, 0x00);
  loc_0b0b(m);
  assert.equal(m.cycles, 33, "ld hl,nn=10 + bit(hl)=12 + ret z=11");
  assert.deepEqual(m.calls, [], "no calls on the guard-fail path");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0b0b: grid hit -> clears cell, calls 0x08f2 twice, stashes results; 511 T", () => {
  const m = mk({ 0x08f2: stub08f2 });
  m.push16(0x9999);
  hitScene(m);
  const ret = loc_0b0b(m);
  assert.equal(m.cycles, 511, "full hit path");
  assert.deepEqual(m.calls, [0x08f2, 0x08f2], "mid-call + tail-jp both hit 0x08f2");
  assert.equal(ret, "T08F2", "the tail-jp's callee result propagates out");
  assert.equal(rd(m, 0x4150), 0x00, "grid cell (0x4150) cleared");
  assert.equal(rd(m, 0x420b), 0x77, "(0x420b) <- returned D");
  assert.equal(rd(m, 0x42b1), 0x77, "(0x42b1) <- returned D");
  assert.equal(rd(m, 0x42b2), 0x00, "(0x42b2) <- 0");
  assert.equal(rd(m, 0x42b3), 0x40, "(0x42b3) <- (0x4209)");
  assert.equal(rd(m, 0x42b4), 0x05, "(0x42b4) <- (0x420a)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0b0b.js
//   find: mem.write8(0x420b, regs.a);
//   repl: mem.write8(0x420c, regs.a);   (stashes D to the wrong cell)
//   expect: FAIL ((0x420b) stays 0 -- caught by the (0x420b) assert)
test("loc_0b0b: contract catches a wrong stash target for (0x420b)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4208; m.step(0x0b0e, 10);
    regs.bit(0, mem.read8(regs.hl)); m.step(0x0b10, 12);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x0b11, 5);
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x0b12, 6);
    regs.a = mem.read8(regs.hl); m.step(0x0b13, 7);
    regs.cp(0x68); m.step(0x0b15, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x0b16, 5);
    regs.sub(0x1e); m.step(0x0b18, 7);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x0b19, 5);
    regs.b = 0x06; m.step(0x0b1b, 7);
    for (;;) {
      regs.sub(0x07); m.step(0x0b1d, 7);
      if (regs.fC) { m.ret(11); return; }
      m.step(0x0b1e, 5);
      regs.sub(0x05); m.step(0x0b20, 7);
      if (regs.fC) { m.step(0x0b25, 12); break; }
      m.step(0x0b22, 7);
      if (regs.djnz() !== 0) { m.step(0x0b1b, 13); continue; }
      m.step(0x0b24, 8); m.ret(); return;
    }
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x0b26, 6);
    regs.a = mem.read8(0x420e); m.step(0x0b29, 13);
    regs.sub(mem.read8(regs.hl)); m.step(0x0b2a, 7);
    regs.neg(); m.step(0x0b2c, 8);
    regs.c = regs.a; m.step(0x0b2d, 4);
    regs.and(0x0f); m.step(0x0b2f, 7);
    regs.sub(0x02); m.step(0x0b31, 7);
    regs.cp(0x0b); m.step(0x0b33, 7);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x0b34, 5);
    regs.b = regs.inc8(regs.b); m.step(0x0b35, 4);
    regs.a = regs.c; m.step(0x0b36, 4);
    regs.and(0xf0); m.step(0x0b38, 7);
    regs.add(regs.b); m.step(0x0b39, 4);
    regs.rrca(); m.step(0x0b3a, 4);
    regs.rrca(); m.step(0x0b3b, 4);
    regs.rrca(); m.step(0x0b3c, 4);
    regs.rrca(); m.step(0x0b3d, 4);
    regs.e = regs.a; m.step(0x0b3e, 4);
    regs.d = 0x00; m.step(0x0b40, 7);
    regs.hl = 0x4100; m.step(0x0b43, 10);
    regs.addHl(regs.de); m.step(0x0b44, 11);
    regs.bit(0, mem.read8(regs.hl)); m.step(0x0b46, 12);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x0b47, 5);
    mem.write8(regs.hl, regs.d); m.step(0x0b48, 7);
    regs.d = 0x01; m.step(0x0b4a, 7);
    regs.e = regs.l; m.step(0x0b4b, 4);
    m.push16(0x0b4e); m.step(0x08f2, 17); m.call(0x08f2);
    regs.a = regs.d; m.step(0x0b4f, 4);
    mem.write8(0x420c, regs.a); m.step(0x0b52, 13); // MUTANT: wrong stash target
    mem.write8(0x42b1, regs.a); m.step(0x0b55, 13);
    regs.xor(regs.a); m.step(0x0b56, 4);
    mem.write8(0x42b2, regs.a); m.step(0x0b59, 13);
    regs.hl = mem.read16(0x4209); m.step(0x0b5c, 16);
    mem.write16(0x42b3, regs.hl); m.step(0x0b5f, 16);
    regs.d = 0x03; m.step(0x0b61, 7);
    regs.a = regs.e; m.step(0x0b62, 4);
    regs.cp(0x50); m.step(0x0b64, 7);
    if (regs.fC) {
      m.step(0x0b72, 12);
      regs.e = 0x00; m.step(0x0b74, 7);
      m.step(0x08f2, 10); return m.call(0x08f2);
    }
    m.step(0x0b66, 7);
    regs.and(0x70); m.step(0x0b68, 7);
    regs.rrca(); m.step(0x0b69, 4);
    regs.rrca(); m.step(0x0b6a, 4);
    regs.rrca(); m.step(0x0b6b, 4);
    regs.rrca(); m.step(0x0b6c, 4);
    regs.sub(0x04); m.step(0x0b6e, 7);
    regs.e = regs.a; m.step(0x0b6f, 4);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk({ 0x08f2: stub08f2 });
  m.push16(0x9999);
  hitScene(m);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x420b), 0x77));
});
