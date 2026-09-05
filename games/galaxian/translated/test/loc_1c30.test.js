// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c30 (Galaxian page-fill loop, ROM 0x1C30-0x1C39): store A into (HL) advancing L
// until it wraps to 0, then A=3 and tail-jump to loc_1b04. Contract uses HL=0x58FE / A=0 so the loop runs
// exactly two iterations (L: fe->ff->00): 59 T, OBJRAM[0xfe]/[0xff] cleared, A=3, tail-jump to 0x1b04.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c30 } from "../loc_1c30.js";

function mk(stubs = { 0x1b04: "tail" }) {
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

function checkSpec(m, ret) {
  assert.equal(m.cycles, 59, "2*(7+4+10) loop + ld a 7 + jp 10");
  assert.equal(m.mem.objRam[0xfe], 0x00, "OBJRAM[0xfe] filled with A(=0)");
  assert.equal(m.mem.objRam[0xff], 0x00, "OBJRAM[0xff] filled with A(=0)");
  assert.equal(m.regs.a, 0x03, "ld a,0x03 after the fill");
  assert.deepEqual(m.calls, [0x1b04], "tail-jump into loc_1b04");
  assert.equal(ret, "TAIL", "tail-jump callee result propagates out");
}

test("loc_1c30: fills the page tail then tail-jumps 0x1b04; 59 T", () => {
  const m = mk();
  m.regs.hl = 0x58fe; m.regs.a = 0x00;
  m.mem.objRam[0xfe] = 0x77; m.mem.objRam[0xff] = 0x77; // seed non-zero to prove the fill
  checkSpec(m, loc_1c30(m));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c30.js
//   find: m.step(0x1b04, 10);\n  return m.call(0x1b04);
//   repl: m.step(0x1b05, 10);\n  return m.call(0x1b05);
//   expect: FAIL  (jumps to 0x1b05 -- caught by calls == [0x1b04])
//   verified-anchor: count == 1  (the sole "return m.call(0x1b04)" in loc_1c30.js)
test("loc_1c30: the contract catches a wrong tail-jump target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a, 4); m.step(0x1c31, 7);
      regs.l = regs.inc8(regs.l); m.step(0x1c32, 4);
      if (regs.fNZ) { m.step(0x1c30, 10); continue; }
      m.step(0x1c35, 10); break;
    }
    regs.a = 0x03; m.step(0x1c37, 7);
    m.step(0x1b05, 10); return m.call(0x1b05); // MUTANT: wrong target
  };
  const m = mk({ 0x1b04: "tail", 0x1b05: "tail" });
  m.regs.hl = 0x58fe; m.regs.a = 0x00;
  const ret = mutant(m);
  assert.throws(() => checkSpec(m, ret));
});
