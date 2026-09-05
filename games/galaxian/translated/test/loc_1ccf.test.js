// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1ccf (Galaxian descriptor-table index, ROM 0x1ccf-0x1cdb):
//   ld b,a / add a,a / add a,a / add a,b  ; A = index*5
//   ld e,a / ld d,0 / ld hl,0x1cf6 / add hl,de  ; HL = 0x1cf6 + index*5
//   ld b,0x02                               ; two words to unstack, fall through -> loc_1cdc
// Contract: A=3 -> HL=0x1cf6+15=0x1d05, B=2, E=15, D=0; 55 T; fall-through -> m.call(0x1cdc).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1ccf } from "../loc_1ccf.js";

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

function run(fn, stubs = { 0x1cdc: "tail" }) {
  const m = mk(stubs);
  m.regs.a = 0x03;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl, b: m.regs.b, e: m.regs.e, d: m.regs.d };
}

function checkSpec(res) {
  assert.equal(res.cycles, 55, "T-state total (4*5 + 7 + 10 + 11 + 7)");
  assert.deepEqual(res.calls, [0x1cdc], "falls through into loc_1cdc");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.hl, 0x1d05, "HL = 0x1cf6 + 3*5 = 0x1d05 (record base)");
  assert.equal(res.b, 0x02, "B=2 words to unstack");
  assert.equal(res.e, 0x0f, "E = index*5 = 15");
  assert.equal(res.d, 0x00, "D=0");
}

test("loc_1ccf: indexes the descriptor record by A*5 then falls through to loc_1cdc; 55 T", () => {
  checkSpec(run(loc_1ccf));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1ccf.js
//   find: regs.add(regs.b);\n  m.step(0x1cd3, 4); // add a,b -- A = index*5 (record stride)
//   repl: regs.add(regs.a);\n  m.step(0x1cd3, 4); // add a,b
//   expect: FAIL  (A becomes index*8 -> HL=0x1cf6+24; caught by the HL/E asserts)
//   verified-anchor: count == 1  (the sole "regs.add(regs.b)" in loc_1ccf.js)
test("loc_1ccf: the contract catches a wrong stride multiplier", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.b = regs.a; m.step(0x1cd0, 4);
    regs.add(regs.a); m.step(0x1cd1, 4);
    regs.add(regs.a); m.step(0x1cd2, 4);
    regs.add(regs.a); m.step(0x1cd3, 4); // MUTANT: add a,a -> index*8
    regs.e = regs.a; m.step(0x1cd4, 4);
    regs.d = 0x00; m.step(0x1cd6, 7);
    regs.hl = 0x1cf6; m.step(0x1cd9, 10);
    regs.addHl(regs.de); m.step(0x1cda, 11);
    regs.b = 0x02; m.step(0x1cdc, 7);
    return m.call(0x1cdc);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
