// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0048 (Galaxian divide-helper entry, ROM 0x0048-0x004B):
//   0048  0e 00  ld c,0x00   ; quotient accumulator
//   004a  06 08  ld b,0x08   ; 8-iteration counter
//   -> fall through to loc_004c (separate routine, the compare/subtract body)
// Contract: C=0, B=8, then tail-calls loc_004c; 14 T (7+7).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0048 } from "../loc_0048.js";

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

function run(fn, stubs = { 0x004c: "tail" }) {
  const m = mk(stubs);
  m.regs.c = 0xff; m.regs.b = 0x00; // arbitrary pre-state
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, c: m.regs.c, b: m.regs.b };
}

function checkSpec(res) {
  assert.equal(res.cycles, 14, "T-state total (ld c,n 7 + ld b,n 7)");
  assert.deepEqual(res.calls, [0x004c], "tail-calls loc_004c (the compare/subtract body)");
  assert.equal(res.ret, "TAIL", "the tail-call result propagates out");
  assert.equal(res.c, 0x00, "C=0 (quotient accumulator cleared)");
  assert.equal(res.b, 0x08, "B=8 (loop counter)");
}

test("loc_0048: clears C, sets B=8, tail-calls loc_004c; 14 T", () => {
  checkSpec(run(loc_0048));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0048.js
//   find: m.step(0x004c, 7); // ld b,0x08 ...\n  return m.call(0x004c);
//   repl: m.step(0x004d, 7); ...  return m.call(0x004d);
//   expect: FAIL  (falls into the wrong routine -- caught by calls == [0x004c])
//   verified-anchor: count == 1  (the sole "return m.call(0x004c)" in loc_0048.js)
test("loc_0048: the contract catches a wrong fall-through target", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.c = 0x00; m.step(0x004a, 7);
    regs.b = 0x08; m.step(0x004d, 7);
    return m.call(0x004d); // MUTANT: wrong fall-through target
  };
  assert.throws(() => checkSpec(run(mutant, { 0x004d: "tail" })));
});
