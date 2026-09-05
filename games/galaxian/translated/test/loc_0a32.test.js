// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0a32 (ROM 0x0a32-0x0a73): input-gated flag arm. Guards on (0x4200)/(0x4208) bit0,
// then ANDs a masked input pair (~(0x4013)&(0x4010), or ~(0x4014)&(0x4011) when (0x4018) bit0 set) with
// 0x10; a hit arms (0x4208)=1 and (0x41cc)=1. Alt (0x4006) bit0 clear path arms only (0x4208). No calls.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0a32 } from "../loc_0a32.js";

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

// scenario reaching loc_0a50 with a hit -> arms both flags
function armScene(m) {
  wr(m, 0x4200, 0x01); // bit0 set -> ret nc not taken
  wr(m, 0x4208, 0x00); // bit0 clear -> ret c not taken
  wr(m, 0x4006, 0x01); // bit0 set -> jr nc not taken
  wr(m, 0x4018, 0x00); // bit0 clear -> use 0x4013/0x4010 pair
  wr(m, 0x4013, 0x00); // cpl -> B=0xff
  wr(m, 0x4010, 0x10); // A&B&0x10 = 0x10 -> hit
}

test("loc_0a32: input hit arms (0x4208) and (0x41cc); 185 T", () => {
  const m = mk();
  m.push16(0x9999);
  armScene(m);
  loc_0a32(m);
  assert.equal(m.cycles, 185, "fall-through hit path via loc_0a50");
  assert.deepEqual(m.calls, [], "no subroutine calls");
  assert.equal(rd(m, 0x4208), 0x01, "(0x4208) armed");
  assert.equal(rd(m, 0x41cc), 0x01, "(0x41cc) armed");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0a32: (0x4200) bit0 clear -> ret nc immediately; 28 T", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x4200, 0x00); // bit0 clear -> carry clear -> ret nc taken
  loc_0a32(m);
  assert.equal(m.cycles, 28, "ld a,(nn)=13 + rrca=4 + ret nc taken=11");
  assert.equal(rd(m, 0x4208), 0x00, "nothing armed");
  assert.equal(m.pc, 0x9999);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0a32.js
//   find: mem.write8(0x41cc, regs.a);
//   repl: mem.write8(0x41cd, regs.a);   (arms the wrong cell)
//   expect: FAIL ((0x41cc) stays 0 -- caught by the (0x41cc) assert)
test("loc_0a32: contract catches a wrong arm-target for (0x41cc)", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4200); m.step(0x0a35, 13);
    regs.rrca(); m.step(0x0a36, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x0a37, 5);
    regs.a = mem.read8(0x4208); m.step(0x0a3a, 13);
    regs.rrca(); m.step(0x0a3b, 4);
    if (regs.fC) { m.ret(11); return; }
    m.step(0x0a3c, 5);
    regs.a = mem.read8(0x4006); m.step(0x0a3f, 13);
    regs.rrca(); m.step(0x0a40, 4);
    if (regs.fNC) {
      m.step(0x0a68, 12);
      regs.a = mem.read8(0x425f); m.step(0x0a6b, 13);
      regs.and(0x1f); m.step(0x0a6d, 7);
      if (regs.fNZ) { m.ret(11); return; }
      m.step(0x0a6e, 5);
      regs.a = 0x01; m.step(0x0a70, 7);
      mem.write8(0x4208, regs.a); m.step(0x0a73, 13);
      m.ret(); return;
    }
    m.step(0x0a42, 7);
    regs.a = mem.read8(0x4018); m.step(0x0a45, 13);
    regs.rrca(); m.step(0x0a46, 4);
    if (regs.fC) {
      m.step(0x0a5d, 12);
      regs.a = mem.read8(0x4014); m.step(0x0a60, 13);
      regs.cpl(); m.step(0x0a61, 4);
      regs.b = regs.a; m.step(0x0a62, 4);
      regs.a = mem.read8(0x4011); m.step(0x0a65, 13);
      m.step(0x0a50, 10);
    } else {
      m.step(0x0a48, 7);
      regs.a = mem.read8(0x4013); m.step(0x0a4b, 13);
      regs.cpl(); m.step(0x0a4c, 4);
      regs.b = regs.a; m.step(0x0a4d, 4);
      regs.a = mem.read8(0x4010); m.step(0x0a50, 13);
    }
    regs.and(regs.b); m.step(0x0a51, 4);
    regs.and(0x10); m.step(0x0a53, 7);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x0a54, 5);
    regs.a = 0x01; m.step(0x0a56, 7);
    mem.write8(0x4208, regs.a); m.step(0x0a59, 13);
    mem.write8(0x41cd, regs.a); m.step(0x0a5c, 13); // MUTANT: wrong target
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  armScene(m);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x41cc), 0x01));
});
