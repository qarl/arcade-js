// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_11d0 (ROM 0x11d0-0x11df): loc_0048 divide (quotient in C), clamp negative to 0x80,
// return (C>>5)&7 octant in A. Contract: positive C=0x60 -> A=3, 64 T, calls [0x0048]; negative C=0x90 ->
// A=4, 71 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_11d0 } from "../loc_11d0.js";

function mk(quotient) {
  const routines = new Map();
  // loc_0048 stub: pop the pushed return, deliver the quotient in C.
  routines.set(0x0048, (mm) => { mm.pop16(); mm.regs.c = quotient; });
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_11d0: positive quotient 0x60 -> octant 3; 64 T", () => {
  const m = mk(0x60);
  m.push16(0x9999);
  loc_11d0(m);
  assert.deepEqual(m.calls, [0x0048], "call the divide helper");
  assert.equal(m.regs.a, 0x03, "(0x60>>5)&7 = 3");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.cycles, 64, "jp-p taken path T-states");
});

test("loc_11d0: negative quotient 0x90 -> clamped to 0x80 -> octant 4; 71 T", () => {
  const m = mk(0x90);
  m.push16(0x9999);
  loc_11d0(m);
  assert.equal(m.regs.a, 0x04, "clamp 0x80, rlca x3 & 7 = 4");
  assert.equal(m.cycles, 71, "jp-p not-taken path T-states");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_11d0.js
//   find: regs.a = 0x80;
//   repl: regs.a = 0x00;   // wrong clamp constant
//   expect: FAIL (negative quotient yields octant 0 instead of 4)
test("loc_11d0: contract catches a wrong negative-clamp constant", () => {
  const m = mk(0x90);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs } = mm;
    mm.push16(0x11d3); mm.step(0x0048, 17); mm.call(0x0048);
    regs.a = regs.c; mm.step(0x11d4, 4);
    regs.and(regs.a); mm.step(0x11d5, 4);
    if (regs.fP) { mm.step(0x11da, 10); } else { mm.step(0x11d8, 10); regs.a = 0x00; mm.step(0x11da, 7); } // MUTANT
    regs.rlca(); mm.step(0x11db, 4);
    regs.rlca(); mm.step(0x11dc, 4);
    regs.rlca(); mm.step(0x11dd, 4);
    regs.and(0x07); mm.step(0x11df, 7);
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x04));
});
