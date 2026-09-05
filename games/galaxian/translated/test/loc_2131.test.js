// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2131 (ROM 0x2131-0x213c):
//   2131  eb        ex de,hl
//   2132  38 09     jr c,0x213d
//   2134  21 57 21  ld hl,0x2157   ; byte-table base
//   2137  78        ld a,b         ; index
//   2138  e7        rst 0x20       ; A=(0x2157+B)
//   2139  eb        ex de,hl
//   213a  c3 a9 25  jp 0x25a9
// Contract (carry clear): 50 T (4+7+10+4+11+4+10), calls [0x0020, 0x25a9], ret propagates the tail,
// rst return 0x2139 pushed. Carry set: 16 T (4+12) then tail into loc_213d.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2131 } from "../loc_2131.js";

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

function runClear(fn) {
  const m = mk({ 0x0020: "mid", 0x25a9: "tail" });
  m.regs.f = 0; // carry clear
  m.regs.b = 0x03; m.regs.de = 0x1111; m.regs.hl = 0x2222;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, de: m.regs.de, hl: m.regs.hl };
}

function checkClear(res) {
  assert.equal(res.cycles, 50, "T-total carry-clear path (4+7+10+4+11+4+10)");
  assert.deepEqual(res.calls, [0x0020, 0x25a9], "rst 0x20 then tail-jump 0x25a9");
  assert.equal(res.ret, "TAIL", "the tail-jump's callee result propagates");
  assert.equal(res.a, 0x03, "ld a,b set A=B before the rst");
  assert.equal(res.de, 0x2157, "second ex de,hl put HL(=0x2157) into DE");
  assert.equal(res.hl, 0x2222, "second ex de,hl restored original DE(=0x2222) into HL");
}

test("loc_2131: carry-clear indexes 0x2157 table + tail-jumps 0x25a9; 50 T", () => {
  checkClear(runClear(loc_2131));
});

test("loc_2131: carry-set branches to loc_213d; 16 T (4+12)", () => {
  const m = mk({ 0x213d: "tail" });
  m.regs.f = 0x01; // carry set
  const ret = loc_2131(m);
  assert.equal(m.cycles, 16, "ex de,hl (4) + jr c taken (12)");
  assert.deepEqual(m.calls, [0x213d], "branches to loc_213d");
  assert.equal(ret, "TAIL");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2131.js
//   find: m.step(0x25a9, 10); // jp 0x25a9\n  return m.call(0x25a9);
//   repl: m.step(0x25aa, 10); // jp 0x25a9\n  return m.call(0x25aa);
//   expect: FAIL (calls == [0x0020, 0x25aa] != [0x0020, 0x25a9])
test("loc_2131: contract catches a wrong tail-jump target", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.exDeHl(); m.step(0x2132, 4);
    m.step(0x2134, 7);
    regs.hl = 0x2157; m.step(0x2137, 10);
    regs.a = regs.b; m.step(0x2138, 4);
    m.push16(0x2139); m.step(0x0020, 11); m.call(0x0020);
    regs.exDeHl(); m.step(0x213a, 4);
    m.step(0x25aa, 10); return m.call(0x25aa); // MUTANT
  };
  const m = mk({ 0x0020: "mid", 0x25aa: "tail" });
  m.regs.f = 0; m.regs.b = 0x03; m.regs.de = 0x1111; m.regs.hl = 0x2222;
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x0020, 0x25a9]));
});
