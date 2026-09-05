// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b0a (set up the exx-based strided VRAM copy, ROM 0x1B0A-0x1B12):
//   1b0a  21 33 52  ld hl,0x5233
//   1b0d  01 20 00  ld bc,0x0020
//   1b10  d9        exx           ; park HL'/BC' in the shadow set
//   1b11  06 07     ld b,0x07     ; main-set row counter
// Contract: 4 instr, 31 T (10+10+4+7); after exx the shadow set holds HL'=0x5233 and BC'=0x0020, the
// main-set counter B=0x07, then it falls through into the copy loop 0x1b13 (via m.call, result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b0a } from "../loc_1b0a.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "NEXT" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubs = { 0x1b13: "tail" }) {
  const m = mk(stubs);
  const ret = fn(m);
  return {
    cycles: m.cycles,
    calls: m.calls,
    ret,
    b: m.regs.b,       // main-set row counter
    hShadow: m.regs.h_, lShadow: m.regs.l_, // shadow HL' = copy destination
    bShadow: m.regs.b_, cShadow: m.regs.c_, // shadow BC' = column stride
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 31, "T-state total (10+10+4+7)");
  assert.deepEqual(res.calls, [0x1b13], "falls through into the copy loop 0x1b13");
  assert.equal(res.ret, "NEXT", "the fall-through callee result propagates out");
  assert.equal(res.b, 0x07, "ld b,0x07 -> main-set row counter B=7");
  assert.equal(res.hShadow, 0x52, "shadow HL' high = 0x52 (dest 0x5233)");
  assert.equal(res.lShadow, 0x33, "shadow HL' low = 0x33 (dest 0x5233)");
  assert.equal(res.bShadow, 0x00, "shadow BC' high = 0x00 (stride 0x0020)");
  assert.equal(res.cShadow, 0x20, "shadow BC' low = 0x20 (stride 0x0020)");
}

test("loc_1b0a: seeds shadow copy pointers + main counter, falls into 0x1b13; 31 T", () => {
  checkSpec(run(loc_1b0a));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b0a.js
//   find: regs.hl = 0x5233;
//   repl: regs.hl = 0x5333;
//   expect: FAIL  (shadow HL' high becomes 0x53 -- caught by hShadow == 0x52)
//   verified-anchor: count == 1  (the sole "regs.hl = 0x5233" in loc_1b0a.js)
test("loc_1b0a: the contract catches a wrong VRAM destination", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x5333; // MUTANT: wrong destination
    m.step(0x1b0d, 10);
    regs.bc = 0x0020;
    m.step(0x1b10, 10);
    regs.exx();
    m.step(0x1b11, 4);
    regs.b = 0x07;
    m.step(0x1b13, 7);
    return m.call(0x1b13);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
