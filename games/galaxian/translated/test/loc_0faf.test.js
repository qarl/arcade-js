// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0faf (ROM 0x0faf-0x101e): object state handler. Exercised path: mode (ix+0x17)<4
// falls to the shared body 0x0fbe, screen-Y small -> top-edge branch 0x0ff6 sets state (ix+0x02)=5.
// Contract: 192 T, calls [0x116b], (ix+0x03) bumped, (ix+0x04)=Y, (ix+0x02)=5.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0faf } from "../loc_0faf.js";

const popret = (mm) => { mm.pop16(); }; // call-target stub keeps SP balanced

function mk() {
  const routines = new Map([[0x116b, popret], [0x11b0, popret]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.regs.ix = 0x4200;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0faf: mode<4 -> body -> top-edge sets state 5; 192 T", () => {
  const m = mk();
  m.mem.write8(0x4217, 0x01); // (ix+0x17) mode < 4
  m.mem.write8(0x4203, 0x10); // (ix+0x03) frame counter
  m.mem.write8(0x4209, 0x02); // (ix+0x09) column
  m.mem.write8(0x4219, 0x01); // (ix+0x19) column offset
  m.push16(0x9999);
  loc_0faf(m);
  assert.equal(m.mem.read8(0x4203), 0x11, "inc (ix+0x03)");
  assert.equal(m.mem.read8(0x4204), 0x03, "(ix+0x04) = (ix+0x09)+(ix+0x19)");
  assert.equal(m.mem.read8(0x4202), 0x05, "top-edge state (ix+0x02)=5");
  assert.deepEqual(m.calls, [0x116b], "per-frame sub 0x116b, no 0x11b0 on this path");
  assert.equal(m.pc, 0x9999, "ret to caller");
  assert.equal(m.cycles, 192, "23+17+19+7+7+7+19+19+19+7+7+12+19+10");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0faf.js
//   find: mem.write8(regs.ix + 0x02, 0x05);   repl: mem.write8(regs.ix + 0x02, 0x04);
//   expect: FAIL (top-edge state byte would be 4, not 5)
test("loc_0faf: contract catches a wrong top-edge state value", () => {
  const m = mk();
  m.mem.write8(0x4217, 0x01);
  m.mem.write8(0x4203, 0x10);
  m.mem.write8(0x4209, 0x02);
  m.mem.write8(0x4219, 0x01);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.incMem8(mem, regs.ix + 0x03); mm.step(0x0fb2, 23);
    mm.push16(0x0fb5); mm.step(0x116b, 17); mm.call(0x116b);
    regs.a = mem.read8(regs.ix + 0x17); mm.step(0x0fb8, 19);
    regs.cp(0x04); mm.step(0x0fba, 7);
    mm.step(0x0fbc, 7); mm.step(0x0fbe, 7); // mode<4: fall to body
    regs.a = mem.read8(regs.ix + 0x09); mm.step(0x0fc1, 19);
    regs.add(mem.read8(regs.ix + 0x19)); mm.step(0x0fc4, 19);
    mem.write8(regs.ix + 0x04, regs.a); mm.step(0x0fc7, 19);
    regs.add(0x07); mm.step(0x0fc9, 7);
    regs.cp(0x0e); mm.step(0x0fcb, 12); // jr c taken
    mem.write8(regs.ix + 0x02, 0x04); mm.step(0x0ffa, 19); // MUTANT: 0x04 not 0x05
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4202), 0x05));
});
