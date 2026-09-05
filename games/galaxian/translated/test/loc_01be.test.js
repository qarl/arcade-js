// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_01be (ROM 0x01be-0x01c5):
//   01be  3e 01     ld a,0x01
//   01c0  32 19 40  ld (0x4019),a
//   01c3  c3 36 03  jp 0x0336
// Contract: 30 T (7+13+10), calls [0x0336], (0x4019)=1, the tail-jump result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_01be } from "../loc_01be.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.routines.set(0x0336, () => "TAIL"); // jp, no return pushed
  return m;
}

test("loc_01be: set (0x4019)=1 then tail-jump 0x0336; 30 T", () => {
  const m = mk();
  const ret = loc_01be(m);
  assert.equal(m.cycles, 30, "7+13+10");
  assert.deepEqual(m.calls, [0x0336], "tail-jump");
  assert.equal(m.mem.read8(0x4019), 0x01, "(0x4019) <- 1");
  assert.equal(ret, "TAIL", "tail-jump result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_01be.js
//   find: regs.a = 0x01;
//   repl: regs.a = 0x00;
//   expect: FAIL ((0x4019) gets 0 instead of 1)
test("loc_01be: the contract catches a wrong (0x4019) value", () => {
  const m = mk();
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.a = 0x00; mm.step(0x01c0, 7); // MUTANT
    mem.write8(0x4019, regs.a); mm.step(0x01c3, 13);
    mm.step(0x0336, 10); return mm.call(0x0336);
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4019), 0x01));
});
