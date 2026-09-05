// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_004c (Galaxian divide-helper compare/subtract body, ROM 0x004c-0x004f):
//   004c  ba     cp d          ; borrow (carry) set iff A<D
//   004d  38 01  jr c,0x0050   ; A<D -> skip the subtract
//   004f  92     sub d         ; A>=D -> A -= D
//   -> fall through into loc_0050
// Contracts: A>=D subtracts and falls through (15 T, A=A-D); A<D jr-takes to loc_0050 (16 T, A unchanged).
// Both paths transfer into loc_0050.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_004c } from "../loc_004c.js";

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

// A>=D: cp d (not carry), sub d, fall through into loc_0050.
function runGe(fn, stubs = { 0x0050: "tail" }) {
  const m = mk(stubs);
  m.regs.a = 0x50; m.regs.d = 0x30; m.regs.f = 0x00;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, c: m.regs.fC };
}

function checkGe(res) {
  assert.equal(res.cycles, 15, "T-state total (cp d 4 + jr-not-taken 7 + sub d 4)");
  assert.deepEqual(res.calls, [0x0050], "falls through into loc_0050");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.a, 0x20, "sub d: 0x50-0x30 = 0x20");
  assert.equal(res.c, false, "sub d left no borrow (0x50>=0x30)");
}

test("loc_004c: A>=D subtracts and falls through to loc_0050; 15 T", () => {
  checkGe(runGe(loc_004c));
});

test("loc_004c: A<D jr-takes to loc_0050, A unchanged; 16 T", () => {
  const m = mk({ 0x0050: "tail" });
  m.regs.a = 0x10; m.regs.d = 0x30; m.regs.f = 0x00;
  loc_004c(m);
  assert.equal(m.cycles, 16, "cp d 4 + jr-taken 12");
  assert.deepEqual(m.calls, [0x0050], "A<D still transfers to loc_0050");
  assert.equal(m.regs.a, 0x10, "no subtract on the carry path");
  assert.equal(m.regs.fC, true, "cp d: 0x10<0x30 -> borrow set");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_004c.js
//   find: regs.sub(regs.d);\n  m.step(0x0050, 4); // sub d -- A>=D: A -= D
//   repl: (delete both lines -- skip the subtract)
//   expect: FAIL  (A stays 0x50 instead of 0x20; caught by the A assert and the 15 T total)
//   verified-anchor: count == 1  (the sole "regs.sub(regs.d)" in loc_004c.js)
test("loc_004c: the contract catches a dropped subtract", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.cp(regs.d);
    m.step(0x004d, 4);
    if (regs.fC) { m.step(0x0050, 12); return m.call(0x0050); }
    m.step(0x004f, 7);
    // MUTANT: sub d dropped
    return m.call(0x0050);
  };
  assert.throws(() => checkGe(runGe(mutant)));
});
