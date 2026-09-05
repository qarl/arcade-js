// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1227 (ROM 0x1227-0x123e): gated by bit0 of (0x4208); else walk 7 objects at IX=0x42d0
// (stride 0x20) calling 0x123f in an exx swap. Contract (enabled): 429 T, 7 calls to 0x123f, IX ends 0x43b0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1227 } from "../loc_1227.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, fn] of Object.entries(stubs)) routines.set(Number(a), fn);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}
const pop = (mm) => { mm.pop16(); };

test("loc_1227: disabled (bit0 of 0x4208 clear) -> immediate ret; 28 T; no calls", () => {
  const m = mk({ 0x123f: pop });
  m.mem.write8(0x4208, 0x00);
  m.push16(0x9999);
  loc_1227(m);
  assert.equal(m.cycles, 28, "13+4+11");
  assert.deepEqual(m.calls, []);
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_1227: enabled -> 7x call 0x123f, IX advances by 0x20; 429 T", () => {
  const m = mk({ 0x123f: pop });
  m.mem.write8(0x4208, 0x01); // bit0 set
  m.push16(0x9999);
  loc_1227(m);
  assert.deepEqual(m.calls, [0x123f, 0x123f, 0x123f, 0x123f, 0x123f, 0x123f, 0x123f]);
  assert.equal(m.regs.ix, 0x43b0, "0x42d0 + 7*0x20");
  assert.equal(m.regs.b, 0x00, "loop counter drained");
  assert.equal(m.cycles, 429, "13+4+5+14+10+7 + 7 iters + ret");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1227.js
//   find: regs.b = 0x07;
//   repl: regs.b = 0x06;
//   expect: FAIL -- only 6 objects walked (calls.length 6, IX ends 0x4390); caught by the calls/IX asserts
test("loc_1227: contract catches a wrong object count", () => {
  const m = mk({ 0x123f: pop });
  m.mem.write8(0x4208, 0x01);
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs } = mm;
    regs.a = mm.mem.read8(0x4208); mm.step(0x122a, 13);
    regs.rrca(); mm.step(0x122b, 4);
    if (regs.fNC) { mm.ret(11); return; }
    mm.step(0x122c, 5);
    regs.ix = 0x42d0; mm.step(0x1230, 14);
    regs.de = 0x0020; mm.step(0x1233, 10);
    regs.b = 0x06; mm.step(0x1235, 7); // MUTANT: 6 not 7
    for (;;) {
      regs.exx(); mm.step(0x1236, 4);
      mm.push16(0x1239); mm.step(0x123f, 17); mm.call(0x123f);
      regs.exx(); mm.step(0x123a, 4);
      regs.addIx(regs.de); mm.step(0x123c, 15);
      if (regs.djnz() !== 0) { mm.step(0x1235, 13); continue; }
      mm.step(0x123e, 8); break;
    }
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.calls.length, 7));
});
