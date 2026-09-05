// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0593 (ROM 0x0593-0x0594): inc L; inc (HL); delegate to loc_0595.
// Contract: 4 + 11 = 15 T, calls [0x0595]; on the loc_0583 fall-in (HL=0x4009) it bumps (0x400a).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0593 } from "../loc_0593.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map([[0x0595, () => {}]]));
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.hl = 0x4009;
  m.mem.write8(0x400a, 3);
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0593: inc L, inc (0x400a), delegate to loc_0595; 15 T", () => {
  const m = mk();
  loc_0593(m);
  assert.equal(m.cycles, 15, "inc l (4) + inc (hl) (11)");
  assert.deepEqual(m.calls, [0x0595], "delegates to loc_0595");
  assert.equal(m.regs.l, 0x0a, "HL 0x4009 -> 0x400a");
  assert.equal(m.mem.read8(0x400a), 4, "inc (0x400a): 3 -> 4");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0593.js
//   find: regs.incMem8(mem, regs.hl);   repl: (drop it)   (0x400a not bumped)
//   expect: FAIL ((0x400a) stays 3)
test("loc_0593: contract catches a dropped inc (hl)", () => {
  const m = mk();
  const { regs, mem } = m;
  regs.l = regs.inc8(regs.l); m.step(0x0594, 4);
  m.step(0x0595, 11); // MUTANT: dropped inc (hl)
  m.call(0x0595);
  assert.throws(() => assert.equal(m.mem.read8(0x400a), 4));
});
