// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_05e2 (ROM 0x05e2-0x05fb): five sound cues via loc_08f2 carrying D from the caller,
// last one a tail-jump. Contract: 116 T, calls [0x08f2 x5], DE sequence [0x0502,0x0602,0x0604,0x0703,0x0700].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_05e2 } from "../loc_05e2.js";

function mk(deSeen) {
  const routines = new Map();
  // loc_08f2 stub: record DE at call time, then pop the pushed return (a normal ret).
  routines.set(0x08f2, (mm) => { deSeen.push(mm.regs.de); mm.pop16(); });
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_05e2: five cues, D carried in, 116 T", () => {
  const deSeen = [];
  const m = mk(deSeen);
  m.regs.de = 0x0500; // caller (loc_05a5) preset: D=0x05, E=0x00
  m.push16(0x9999); // caller return consumed by the tail cue
  loc_05e2(m);
  assert.equal(m.cycles, 116, "sum of instr T-states");
  assert.deepEqual(m.calls, [0x08f2, 0x08f2, 0x08f2, 0x08f2, 0x08f2], "five loc_08f2 cues");
  assert.deepEqual(deSeen, [0x0502, 0x0602, 0x0604, 0x0703, 0x0700], "DE per cue (inc d bumps the 2nd)");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_05e2.js
//   find: regs.d = regs.inc8(regs.d);  repl: (drop it)
//   expect: FAIL -- 2nd cue's DE is 0x0502 not 0x0602 (caught by the deSeen sequence)
test("loc_05e2: dropped `inc d` gives the wrong 2nd cue", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.e = 0x02; m.step(0x05e4, 7);
    m.push16(0x05e7); m.step(0x08f2, 17); m.call(0x08f2);
    m.step(0x05e8, 4); // MUTANT: dropped `inc d`
    m.push16(0x05eb); m.step(0x08f2, 17); m.call(0x08f2);
    regs.e = 0x04; m.step(0x05ed, 7);
    m.push16(0x05f0); m.step(0x08f2, 17); m.call(0x08f2);
    regs.de = 0x0703; m.step(0x05f3, 10);
    m.push16(0x05f6); m.step(0x08f2, 17); m.call(0x08f2);
    regs.de = 0x0700; m.step(0x05f9, 10);
    m.step(0x08f2, 10); return m.call(0x08f2);
  };
  const deSeen = [];
  const m = mk(deSeen);
  m.regs.de = 0x0500;
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(deSeen, [0x0502, 0x0602, 0x0604, 0x0703, 0x0700]));
});
