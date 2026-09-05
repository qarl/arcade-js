// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1292 (ROM 0x1292-0x129d): A++ iff bit0 of (ix+0x20) AND (ix+0x40) are both clear.
// Contract for the both-clear path: 64 T, no calls, A incremented, ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1292 } from "../loc_1292.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn) {
  const m = mk();
  m.regs.ix = 0x4300;
  m.mem.write8(0x4320, 0x00); // (ix+0x20) inactive
  m.mem.write8(0x4340, 0x00); // (ix+0x40) inactive
  m.regs.a = 0x03;
  m.push16(0x9999); // caller return for the final ret
  fn(m);
  return m;
}

test("loc_1292: both neighbours inactive -> A++ ; 64 T, ret to caller", () => {
  const m = run(loc_1292);
  assert.equal(m.cycles, 64, "sum of the both-clear-path T-states");
  assert.deepEqual(m.calls, [], "no sub-calls");
  assert.equal(m.regs.a, 0x04, "A incremented from 0x03");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1292.js
//   find: regs.a = regs.inc8(regs.a);
//   repl: (drop it -- A stays unchanged)
//   expect: FAIL (A stays 0x03 instead of 0x04)
test("loc_1292: the contract catches a dropped `inc a`", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.bit(0, mem.read8((regs.ix + 0x20) & 0xffff), ((regs.ix + 0x20) >> 8) & 0xff);
    m.step(0x1296, 20);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x1297, 5);
    regs.bit(0, mem.read8((regs.ix + 0x40) & 0xffff), ((regs.ix + 0x40) >> 8) & 0xff);
    m.step(0x129b, 20);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x129c, 5);
    m.step(0x129d, 4); // MUTANT: dropped `inc a`
    m.ret();
  };
  const m = run(mutant);
  assert.throws(() => assert.equal(m.regs.a, 0x04));
});
