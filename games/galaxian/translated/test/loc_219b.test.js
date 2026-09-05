// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_219b (ROM 0x219b-0x21a5): call 0x2187, ld a,0x60, ld hl,0x51fc, jp 0x2585.
// Contract: 44 T (17+7+10+10), calls [0x2187, 0x2585], A=0x60, HL=0x51fc, tail result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_219b } from "../loc_219b.js";

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
const ret2187 = (mm) => { mm.pop16(); }; // loc_2187 rets cleanly
const tail2585 = () => "TAIL";

function run(fn) {
  const m = mk({ 0x2187: ret2187, 0x2585: tail2585 });
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, hl: m.regs.hl };
}

function checkSpec(res) {
  assert.equal(res.cycles, 44, "T-state total (17+7+10+10)");
  assert.deepEqual(res.calls, [0x2187, 0x2585], "call 0x2187 then tail-jp 0x2585");
  assert.equal(res.ret, "TAIL", "tail-jump result propagates out");
  assert.equal(res.a, 0x60, "ld a,0x60 -- tile seed");
  assert.equal(res.hl, 0x51fc, "ld hl,0x51fc -- VRAM dest");
}

test("loc_219b: sets A/HL and tail-jumps to loc_2585; 44 T", () => {
  checkSpec(run(loc_219b));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_219b.js
//   find: m.step(0x2585, 10);\n  return m.call(0x2585);
//   repl: m.step(0x2595, 10);\n  return m.call(0x2595);
//   expect: FAIL (wrong tail target -- caught by calls == [0x2187, 0x2585])
test("loc_219b: the contract catches a wrong tail-jump target", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x219e); m.step(0x2187, 17); m.call(0x2187);
    regs.a = 0x60; m.step(0x21a0, 7);
    regs.hl = 0x51fc; m.step(0x21a3, 10);
    m.step(0x2595, 10); // MUTANT: wrong target
    return m.call(0x2595);
  };
  const m = mk({ 0x2187: ret2187, 0x2595: tail2585 });
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x2187, 0x2585]));
});
