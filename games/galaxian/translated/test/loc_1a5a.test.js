// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a5a (Galaxian cold-boot VRAM page-pass top, ROM 0x1A5A-0x1A5B):
//   1a5a  3e 10  ld a,0x10   ; reload the VRAM fill byte (blank tile)
// Contract: 1 instr, 7 T, A=0x10, TAIL-fall into loc_1a5c (via m.call, result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a5a } from "../loc_1a5a.js";

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

function run(fn, stubs = { 0x1a5c: "tail" }) {
  const m = mk(stubs);
  m.regs.a = 0x00; // pre-clear so the load's effect is observable
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a };
}

function checkSpec(res) {
  assert.equal(res.cycles, 7, "T-state total (ld a,n = 7)");
  assert.deepEqual(res.calls, [0x1a5c], "tail-falls into the page-fill loop 0x1a5c");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.a, 0x10, "ld a,0x10 -> A=0x10 (blank tile fill byte)");
}

test("loc_1a5a: loads the VRAM fill byte 0x10, tail-falls into 0x1a5c; 7 T", () => {
  checkSpec(run(loc_1a5a));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a5a.js
//   find: regs.a = 0x10;
//   repl: regs.a = 0x20;
//   expect: FAIL  (wrong fill byte -- caught by a == 0x10)
//   verified-anchor: count == 1  (the sole "regs.a = 0x10" in loc_1a5a.js)
test("loc_1a5a: the contract catches a wrong fill byte", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.a = 0x20; // MUTANT: wrong fill byte
    m.step(0x1a5c, 7);
    return m.call(0x1a5c);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
