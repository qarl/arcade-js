// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0cc3 (ROM 0x0cc3-0x0cd5): drive the 8 object slots at 0x42b0 (0x20 stride) by
// calling loc_0cd6 on each, exx-bracketed. Contract: 460 T, eight 0x0cd6 calls, IX ends 0x43b0, ret.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0cc3 } from "../loc_0cc3.js";

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
// loc_0cd6 stub: the dispatched target rets to the caller, so pop loc_0cc3's pushed 0x0cd0.
const drv = (mm) => { mm.pop16(); };

test("loc_0cc3: 8 slots x loc_0cd6, stride 0x20; 460 T; IX ends 0x43b0", () => {
  const m = mk({ 0x0cd6: drv });
  m.push16(0x9999);
  loc_0cc3(m);
  assert.equal(m.cycles, 460, "sum of all instr T-states (7 djnz taken + 1 not)");
  assert.deepEqual(m.calls, Array(8).fill(0x0cd6), "loc_0cd6 called once per slot");
  assert.equal(m.regs.ix, 0x43b0, "IX advanced 8 * 0x20 from 0x42b0");
  assert.equal(m.regs.b, 0x00, "B counted down to 0");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0cc3.js
//   find: regs.de = 0x0020;   repl: regs.de = 0x0010;
//   expect: FAIL -- IX ends 0x4330 not 0x43b0; caught by the IX assert.
test("loc_0cc3: the contract catches a wrong slot stride", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.ix = 0x42b0; m.step(0x0cc7, 14);
    regs.de = 0x0010; m.step(0x0cca, 10); // MUTANT: stride 0x10 not 0x20
    regs.b = 0x08; m.step(0x0ccc, 7);
    for (;;) {
      regs.exx(); m.step(0x0ccd, 4);
      m.push16(0x0cd0); m.step(0x0cd6, 17); m.call(0x0cd6);
      regs.exx(); m.step(0x0cd1, 4);
      regs.addIx(regs.de); m.step(0x0cd3, 15);
      if (regs.djnz() !== 0) { m.step(0x0ccc, 13); continue; }
      m.step(0x0cd5, 8); break;
    }
    m.ret();
  };
  const m = mk({ 0x0cd6: drv });
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.regs.ix, 0x43b0));
});
