// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_185e (ROM 0x185e-0x186b):
//   185e  7c        ld a,h
//   185f  a7        and a
//   1860  c8        ret z
//   1861  3d        dec a
//   1862  32 c8 41  ld (0x41c8),a
//   1865  e6 04     and 0x04
//   1867  ca 6c 18  jp z,0x186c
//   186a  3e 81     ld a,0x81
//   (falls through into loc_186c)
// Contract (H!=0, bit2 of H-1 set): 54 T (4+4+5+4+13+7+10+7), stores H-1 to 0x41c8, A=0x81, delegate 0x186c.
// Also: H==0 returns in 19 T; bit2 clear delegates with A=0 in 47 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_185e } from "../loc_185e.js";

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
  m.regs.sp = 0x4380; m.mem.write16(0x4380, 0x1234);
  return m;
}

function runFull(fn) {
  const m = mk({ 0x186c: "tail" });
  m.regs.h = 0x06; // H!=0, H-1=0x05, bit2 set -> jp z not taken -> A=0x81
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hi: m.mem.read8(0x41c8), a: m.regs.a };
}

function checkSpec(res) {
  assert.equal(res.cycles, 54, "T-state total (4+4+5+4+13+7+10+7)");
  assert.deepEqual(res.calls, [0x186c], "falls through into loc_186c");
  assert.equal(res.ret, "TAIL", "delegated result propagates out");
  assert.equal(res.hi, 0x05, "0x41c8 = H-1 (0x06-1)");
  assert.equal(res.a, 0x81, "bit2 set path selects A=0x81 for loc_186c");
}

test("loc_185e: H!=0, bit2 set -> store H-1, A=0x81, delegate loc_186c; 54 T", () => {
  checkSpec(runFull(loc_185e));
});

test("loc_185e: H==0 returns early; 19 T", () => {
  const m = mk();
  m.regs.h = 0x00;
  loc_185e(m);
  assert.equal(m.cycles, 19, "T-state total (4+4+11)");
  assert.deepEqual(m.calls, [], "ret z, no delegate");
});

test("loc_185e: H!=0, bit2 clear -> A=0 into loc_186c; 47 T", () => {
  const m = mk({ 0x186c: "tail" });
  m.regs.h = 0x02; // H-1=0x01, bit2 clear -> jp z taken with A=0
  loc_185e(m);
  assert.equal(m.cycles, 47, "T-state total (4+4+5+4+13+7+10)");
  assert.deepEqual(m.calls, [0x186c], "delegate loc_186c");
  assert.equal(m.mem.read8(0x41c8), 0x01, "0x41c8 = H-1");
  assert.equal(m.regs.a, 0x00, "and 0x04 left A=0 (bit2 clear)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_185e.js
//   find: regs.a = regs.dec8(regs.a);   (the sole dec a)
//   repl: (delete it)                   -- stores H instead of H-1
//   expect: FAIL -- checkSpec asserts 0x41c8 == 0x05, mutant stores 0x06
test("loc_185e: the contract catches a missing dec a", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = regs.h;
    m.step(0x185f, 4);
    regs.and(regs.a);
    m.step(0x1860, 4);
    if (regs.fZ) { m.ret(11); return; }
    m.step(0x1861, 5);
    // MUTANT: no dec a
    mem.write8(0x41c8, regs.a);
    m.step(0x1865, 13);
    regs.and(0x04);
    m.step(0x1867, 7);
    if (regs.fZ) { m.step(0x186c, 10); return m.call(0x186c); }
    m.step(0x186a, 10);
    regs.a = 0x81;
    m.step(0x186c, 7);
    return m.call(0x186c);
  };
  assert.throws(() => checkSpec(runFull(mutant)));
});
