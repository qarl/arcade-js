// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_03f2 (ROM 0x03f2-0x03ff): per-frame prep (0x090d, 0x098e), push 0x0492 as the
// post-dispatch continuation, then rst 0x28 state-dispatch (0x0028) on (0x400a). Contract: 79 T,
// calls [0x090d,0x098e,0x0028,0x0492], A = state index, 0x0492 pushed as the return addr.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_03f2 } from "../loc_03f2.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_03f2: prep + rst-28 dispatch on (0x400a), 0x0492 continuation; 79 T", () => {
  const m = mk({ 0x090d: "mid", 0x098e: "mid", 0x0028: "mid", 0x0492: "tail" });
  m.regs.a = 0xee;
  m.mem.workRam[0x00a] = 0x02; // (0x400a) game-state index
  const ret = loc_03f2(m);
  assert.equal(m.cycles, 79, "T-state total (17+17+10+11+13+11)");
  assert.deepEqual(m.calls, [0x090d, 0x098e, 0x0028, 0x0492],
    "two prep calls, the rst-28 dispatch, then the 0x0492 continuation");
  assert.equal(ret, "TAIL", "the 0x0492 continuation's result propagates out");
  assert.equal(m.regs.a, 0x02, "A = (0x400a) state index read before the dispatch");
  assert.equal(m.pop16(), 0x0492, "0x0492 pushed as the dispatched routine's return addr");
});

// MUTATION-PATCH: drop `ld a,(0x400a)` so A keeps its seeded 0xEE instead of the state index.
test("loc_03f2: contract catches a dropped state-index read", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x03f5); m.step(0x090d, 17); m.call(0x090d);
    m.push16(0x03f8); m.step(0x098e, 17); m.call(0x098e);
    regs.hl = 0x0492; m.step(0x03fb, 10);
    m.push16(regs.hl); m.step(0x03fc, 11);
    m.step(0x03ff, 13); // MUTANT: dropped `ld a,(0x400a)`
    m.push16(0x0400); m.step(0x0028, 11); m.call(0x0028);
    return m.call(0x0492);
  };
  const m = mk({ 0x090d: "mid", 0x098e: "mid", 0x0028: "mid", 0x0492: "tail" });
  m.regs.a = 0xee;
  m.mem.workRam[0x00a] = 0x02;
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x02));
});
