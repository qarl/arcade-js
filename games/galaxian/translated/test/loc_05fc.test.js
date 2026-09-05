// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_05fc (ROM 0x05fc-0x0604): one cue (D:E=0x0503) via loc_08f2, then jp into loc_05e2.
// Contract: 37 T, calls [0x08f2, 0x05e2], the cue's DE is 0x0503.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_05fc } from "../loc_05fc.js";

function mk(deSeen) {
  const routines = new Map();
  routines.set(0x08f2, (mm) => { deSeen.push(mm.regs.de); mm.pop16(); });
  routines.set(0x05e2, () => "E2"); // tail target stub
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_05fc: cue 0x0503 then tail-jump loc_05e2, 37 T", () => {
  const deSeen = [];
  const m = mk(deSeen);
  m.push16(0x9999);
  const ret = loc_05fc(m);
  assert.equal(m.cycles, 37, "sum of instr T-states");
  assert.deepEqual(m.calls, [0x08f2, 0x05e2], "one cue then tail into loc_05e2");
  assert.deepEqual(deSeen, [0x0503], "cue DE = 0x0503");
  assert.equal(ret, "E2", "the tail-jump's callee result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_05fc.js
//   find: regs.de = 0x0503;  repl: regs.de = 0x0500;
//   expect: FAIL -- cue DE is 0x0500 not 0x0503 (caught by deSeen)
test("loc_05fc: wrong cue value is caught", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.de = 0x0500; m.step(0x05ff, 10); // MUTANT: wrong cue
    m.push16(0x0602); m.step(0x08f2, 17); m.call(0x08f2);
    m.step(0x05e2, 10); return m.call(0x05e2);
  };
  const deSeen = [];
  const m = mk(deSeen);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(deSeen, [0x0503]));
});
