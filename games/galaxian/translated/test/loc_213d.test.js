// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_213d (ROM 0x213d-0x2145):
//   213d  78        ld a,b
//   213e  a7        and a          ; flags from B
//   213f  f2 46 21  jp p,0x2146    ; if S clear
//   2142  3e a4     ld a,0xa4
//   2144  18 04     jr 0x214a
// Contract (B negative, S set): 37 T (4+4+10+7+12), calls [0x214a], A=0xa4, tail propagates.
// (B non-negative, S clear): 18 T (4+4+10) then tail into loc_2146.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_213d } from "../loc_213d.js";

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

function runNeg(fn) {
  const m = mk({ 0x214a: "tail" });
  m.regs.b = 0x80; // bit7 set -> S set after `and a`
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a };
}

function checkNeg(res) {
  assert.equal(res.cycles, 37, "T-total S-set path (4+4+10+7+12)");
  assert.deepEqual(res.calls, [0x214a], "falls to A=0xa4 then jr into loc_214a");
  assert.equal(res.ret, "TAIL", "tail result propagates");
  assert.equal(res.a, 0xa4, "ld a,0xa4 on the fall-through arm");
}

test("loc_213d: B negative -> A=0xa4, tail loc_214a; 37 T", () => {
  checkNeg(runNeg(loc_213d));
});

test("loc_213d: B non-negative -> jp p into loc_2146; 18 T (4+4+10)", () => {
  const m = mk({ 0x2146: "tail" });
  m.regs.b = 0x03; // S clear
  const ret = loc_213d(m);
  assert.equal(m.cycles, 18, "ld a,b + and a + jp p (4+4+10)");
  assert.deepEqual(m.calls, [0x2146], "jumps to loc_2146");
  assert.equal(ret, "TAIL");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_213d.js
//   find: if (regs.fP) {\n    m.step(0x2146, 10);
//   repl: if (regs.fM) {\n    m.step(0x2146, 10);
//   expect: FAIL (branch condition inverted: B=0x80 would now take the jump -> calls [0x2146])
test("loc_213d: contract catches an inverted branch condition", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.a = regs.b; m.step(0x213e, 4);
    regs.and(regs.a); m.step(0x213f, 4);
    if (regs.fM) { m.step(0x2146, 10); return m.call(0x2146); } // MUTANT: fM instead of fP
    m.step(0x2142, 10);
    regs.a = 0xa4; m.step(0x2144, 7);
    m.step(0x214a, 12); return m.call(0x214a);
  };
  const m = mk({ 0x2146: "tail", 0x214a: "tail" });
  m.regs.b = 0x80;
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x214a]));
});
