// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1aa0 (work-RAM march-test WRITE loop, ROM 0x1aa0-0x1ab0):
//   1aa0  add a,0x2f / ld (hl),a / inc l / jp nz,0x1aa0   ; write A+0x2F per byte, loop the page
//   1aa7  inc a / inc h / djnz 0x1aa0                      ; bump seed, next page, 4 pages
//   1aab  ld hl,0x4000 / ld b,0x04 / ld a,c               ; re-seed for verify, fall through -> loc_1ab1
// Contract exercised with a SHORT deterministic path: H=0x40, L=0xFD, B=1, A=0, C=0x55.
//   inner loop runs 3 times (l: FD->FE->FF->00), then one page (B=1), then the re-seed tail.
//   T = 3*(7+7+4+10) + (4+4+8) + (10+7+4) = 84 + 16 + 21 = 121 T; fall-through -> m.call(0x1ab1).
//   pattern stored: (0x40FD)=0x2f, (0x40FE)=0x5e, (0x40FF)=0x8d.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1aa0 } from "../loc_1aa0.js";

function mk(stubAddrs = []) {
  const routines = new Map();
  for (const a of stubAddrs) routines.set(Number(a), () => "STUB");
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubAddrs = [0x1ab1]) {
  const m = mk(stubAddrs);
  m.regs.h = 0x40; m.regs.l = 0xfd; m.regs.b = 0x01; m.regs.a = 0x00; m.regs.c = 0x55;
  const ret = fn(m);
  return {
    cycles: m.cycles,
    calls: m.calls,
    ret,
    a: m.regs.a,
    b: m.regs.b,
    hl: m.regs.hl,
    m40fd: m.mem.read8(0x40fd),
    m40fe: m.mem.read8(0x40fe),
    m40ff: m.mem.read8(0x40ff),
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 121, "T-state total 3*(7+7+4+10)+(4+4+8)+(10+7+4)");
  assert.deepEqual(res.calls, [0x1ab1], "falls through into the verify loop loc_1ab1");
  assert.equal(res.hl, 0x4000, "re-seeded HL=0x4000 for the verify pass");
  assert.equal(res.b, 0x04, "re-seeded B=0x04");
  assert.equal(res.a, 0x55, "ld a,c re-loaded the seed C=0x55");
  assert.equal(res.m40fd, 0x2f, "(0x40FD) = A+0x2F on iter 1");
  assert.equal(res.m40fe, 0x5e, "(0x40FE) = pattern on iter 2");
  assert.equal(res.m40ff, 0x8d, "(0x40FF) = pattern on iter 3");
}

test("loc_1aa0: work-RAM write loop fills the walking pattern, falls through to loc_1ab1; 121 T", () => {
  checkSpec(run(loc_1aa0));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1aa0.js
//   find: regs.add(0x2f);\n    m.step(0x1aa2, 7); // add a,0x2f
//   repl: regs.add(0x2e);\n    m.step(0x1aa2, 7); // add a,0x2f
//   expect: FAIL  (wrong pattern constant -> (0x40FF)=0x8a not 0x8d; caught by the memory asserts)
//   verified-anchor: count == 1  (the sole "regs.add(0x2f)" before m.step(0x1aa2,...) in loc_1aa0.js)
test("loc_1aa0: the contract catches a wrong fill constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      regs.add(0x2e); // MUTANT: wrong pattern constant
      m.step(0x1aa2, 7);
      mem.write8(regs.hl, regs.a);
      m.step(0x1aa3, 7);
      regs.l = regs.inc8(regs.l);
      m.step(0x1aa4, 4);
      if (regs.fNZ) { m.step(0x1aa0, 10); continue; }
      m.step(0x1aa7, 10);
      regs.a = regs.inc8(regs.a);
      m.step(0x1aa8, 4);
      regs.h = regs.inc8(regs.h);
      m.step(0x1aa9, 4);
      if (regs.djnz() !== 0) { m.step(0x1aa0, 13); continue; }
      m.step(0x1aab, 8);
      break;
    }
    regs.hl = 0x4000; m.step(0x1aae, 10);
    regs.b = 0x04; m.step(0x1ab0, 7);
    regs.a = regs.c; m.step(0x1ab1, 4);
    return m.call(0x1ab1);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
