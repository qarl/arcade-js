// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_097d (ROM 0x097d-0x0982): (0x420d) <- 1; ret. Contract: 30 T, direction flag set.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_097d } from "../loc_097d.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0x9999);
  return m;
}

test("loc_097d: sets direction flag (0x420d)=1; 30 T; ret", () => {
  const m = mk();
  loc_097d(m);
  assert.equal(m.cycles, 30, "ld a,n (7) + ld (nn),a (13) + ret (10)");
  assert.equal(m.mem.read8(0x420d), 0x01, "direction flag <- 1");
  assert.equal(m.regs.a, 0x01);
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_097d.js
//   find: regs.a = 0x01;
//   repl: regs.a = 0x00; (confuse with loc_0983 which clears the same cell)
//   expect: FAIL ((0x420d) gets 0 instead of 1; caught by the read8 assert)
test("loc_097d: the contract catches writing 0 instead of 1", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = 0x00; // MUTANT
    m.step(0x097f, 7);
    mem.write8(0x420d, regs.a);
    m.step(0x0982, 13);
    m.ret();
  };
  const m = mk();
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x420d), 0x01));
});
