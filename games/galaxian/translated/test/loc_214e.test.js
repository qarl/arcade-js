// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_214e (ROM 0x214e-0x2156):
//   214e  21 40 53  ld hl,0x5340
//   2151  a7        and a
//   2152  c8        ret z          ; A==0 -> return HL=0x5340
//   2153  21 e0 50  ld hl,0x50e0
//   2156  c9        ret            ; else HL=0x50e0
// Contract (A==0): 25 T (10+4+11), HL=0x5340, RET to the pushed addr.
// (A!=0): 39 T (10+4+5+10+10), HL=0x50e0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_214e } from "../loc_214e.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.push16(0x1234); // caller return address for RET to pop
  return m;
}

function run(fn, a) {
  const m = mk();
  m.regs.a = a;
  fn(m);
  return { cycles: m.cycles, hl: m.regs.hl, pc: m.pc };
}

test("loc_214e: A==0 -> HL=0x5340 via ret z; 25 T", () => {
  const r = run(loc_214e, 0x00);
  assert.equal(r.cycles, 25, "T-total ret-z-taken (10+4+11)");
  assert.equal(r.hl, 0x5340, "A==0 returns HL=0x5340");
  assert.equal(r.pc, 0x1234, "ret z popped the caller return");
});

test("loc_214e: A!=0 -> HL=0x50e0 via final ret; 39 T", () => {
  const r = run(loc_214e, 0x07);
  assert.equal(r.cycles, 39, "T-total full path (10+4+5+10+10)");
  assert.equal(r.hl, 0x50e0, "A!=0 returns HL=0x50e0");
  assert.equal(r.pc, 0x1234, "final ret popped the caller return");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_214e.js
//   find: if (regs.fZ) {\n    m.ret(11); // ret z (taken): HL=0x5340
//   repl: if (regs.fNZ) {\n    m.ret(11); // ret z (taken): HL=0x5340
//   expect: FAIL (A==0 would fall through to HL=0x50e0 instead of 0x5340)
test("loc_214e: contract catches an inverted ret-z condition", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x5340; m.step(0x2151, 10);
    regs.and(regs.a); m.step(0x2152, 4);
    if (regs.fNZ) { m.ret(11); return; } // MUTANT: fNZ
    m.step(0x2153, 5);
    regs.hl = 0x50e0; m.step(0x2156, 10);
    m.ret();
  };
  const m = mk(); m.regs.a = 0x00;
  mutant(m);
  assert.throws(() => assert.equal(m.regs.hl, 0x5340));
});
