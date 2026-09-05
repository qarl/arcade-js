// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0605 (ROM 0x0605-0x0613): dec (0x4009); ret nz while counting, else reload 0x14,
// inc (0x400a), tail-jump loc_08f2 with cue 0x0682. Contracts: ret-nz path 32 T; zero-cross path 71 T.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0605 } from "../loc_0605.js";

function mk() {
  const routines = new Map();
  routines.set(0x08f2, () => "F2"); // tail cue stub
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0605: still counting -> ret nz, 32 T, no cue", () => {
  const m = mk();
  m.mem.write8(0x4009, 2); // dec -> 1 (nonzero)
  m.push16(0x9999);
  loc_0605(m);
  assert.equal(m.cycles, 32, "10 + 11 + 11(ret taken)");
  assert.deepEqual(m.calls, [], "no cue while counting");
  assert.equal(m.mem.read8(0x4009), 1, "timer decremented");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0605: zero-cross -> reload + advance state + cue 0x0682, 71 T", () => {
  const m = mk();
  m.mem.write8(0x4009, 1); // dec -> 0
  m.mem.write8(0x400a, 3); // state cell
  m.push16(0x9999);
  const ret = loc_0605(m);
  assert.equal(m.cycles, 71, "full straight-line path");
  assert.deepEqual(m.calls, [0x08f2], "tail cue");
  assert.equal(m.mem.read8(0x4009), 0x14, "timer reloaded");
  assert.equal(m.mem.read8(0x400a), 4, "state advanced");
  assert.equal(m.regs.de, 0x0682, "cue D:E = 0x0682");
  assert.equal(ret, "F2", "tail cue result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0605.js
//   find: regs.incMem8(mem, regs.hl);  repl: (drop it)
//   expect: FAIL -- 0x400a stays 3, not 4 (caught by the state-advance assert)
test("loc_0605: dropped state advance is caught", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4009; m.step(0x0608, 10);
    regs.decMem8(mem, regs.hl); m.step(0x0609, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x060a, 5);
    mem.write8(regs.hl, 0x14); m.step(0x060c, 10);
    regs.l = regs.inc8(regs.l); m.step(0x060d, 4);
    m.step(0x060e, 11); // MUTANT: dropped inc (0x400a)
    regs.de = 0x0682; m.step(0x0611, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const m = mk();
  m.mem.write8(0x4009, 1);
  m.mem.write8(0x400a, 3);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x400a), 4));
});
