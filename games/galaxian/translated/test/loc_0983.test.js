// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0983 (ROM 0x0983-0x0987): clear the 0x420d flag cell, ret. Contract: 27 T, no calls,
// (0x420d)=0, returns to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0983 } from "../loc_0983.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const rd = (m, a) => m.mem.workRam[a & 0x3ff];
const wr = (m, a, v) => { m.mem.workRam[a & 0x3ff] = v; };

test("loc_0983: clears 0x420d; 27 T; ret", () => {
  const m = mk();
  m.push16(0x9999);
  wr(m, 0x420d, 0xff); // pre-set so the clear is observable
  loc_0983(m);
  assert.equal(m.cycles, 27, "xor 4 + ld(nn)a 13 + ret 10");
  assert.equal(rd(m, 0x420d), 0x00, "flag cell cleared");
  assert.deepEqual(m.calls, [], "no calls");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH loc_0983.js: `mem.write8(0x420d, regs.a)` -> `mem.write8(0x420e, regs.a)`
//   the clear would land on the wrong cell; caught by the (0x420d)==0 assert (0x420d stays 0xff).
test("loc_0983: contract catches a wrong store address", () => {
  const m = mk();
  wr(m, 0x420d, 0xff);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.xor(regs.a); mm.step(0x0984, 4);
    mem.write8(0x420e, regs.a); mm.step(0x0987, 13); // MUTANT: wrong cell
    mm.ret();
  };
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(rd(m, 0x420d), 0x00));
});
