// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_186c (ROM 0x186c-0x1875):
//   186c  3d        dec a
//   186d  32 c1 41  ld (0x41c1),a
//   1870  3e 01     ld a,0x01
//   1872  32 c0 41  ld (0x41c0),a
//   1875  c9        ret
// Contract: 47 T (4+13+7+13+10), 0x41c1 = A-1, 0x41c0 = 1, ret, no m.call.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_186c } from "../loc_186c.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.regs.sp = 0x4380; m.mem.write16(0x4380, 0x1234);
  return m;
}

function run(fn) {
  const m = mk();
  m.regs.a = 0x81; // as loc_185e would hand it in
  fn(m);
  return { cycles: m.cycles, calls: m.calls, c1: m.mem.read8(0x41c1), c0: m.mem.read8(0x41c0) };
}

function checkSpec(res) {
  assert.equal(res.cycles, 47, "T-state total (4+13+7+13+10)");
  assert.deepEqual(res.calls, [], "self-contained, no delegate");
  assert.equal(res.c1, 0x80, "0x41c1 = A-1 (0x81-1)");
  assert.equal(res.c0, 0x01, "0x41c0 = 1 (flag raised)");
}

test("loc_186c: store A-1 to 0x41c1, raise 0x41c0=1; 47 T", () => {
  checkSpec(run(loc_186c));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_186c.js
//   find: regs.a = 0x01;
//   repl: regs.a = 0x02;   (wrong flag value)
//   expect: FAIL -- checkSpec asserts 0x41c0 == 0x01, mutant writes 0x02
test("loc_186c: the contract catches a wrong flag value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = regs.dec8(regs.a);
    m.step(0x186d, 4);
    mem.write8(0x41c1, regs.a);
    m.step(0x1870, 13);
    regs.a = 0x02; // MUTANT
    m.step(0x1872, 7);
    mem.write8(0x41c0, regs.a);
    m.step(0x1875, 13);
    m.ret();
  };
  assert.throws(() => checkSpec(run(mutant)));
});
