// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_129e (ROM 0x129e-0x12b5): gated by (0x4200) bit0, walk 7 structs at IX=0x42d0
// (stride 0x20) calling loc_12b6 on each. Contract for the enabled path: 429 T, calls [0x12b6 x7],
// IX ends at 0x43b0 (0x42d0 + 7*0x20), ret to caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_129e } from "../loc_129e.js";

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
// loc_12b6 rets to 0x12b0: pop the pushed return address (clean ret, no other effect here).
const stub12b6 = (mm) => { mm.pop16(); };

function run(fn) {
  const m = mk({ 0x12b6: stub12b6 });
  m.mem.write8(0x4200, 0x01); // bit0 set -> enabled
  m.push16(0x9999); // caller return for the final ret
  fn(m);
  return m;
}

test("loc_129e: enabled -> 7 loc_12b6 calls, IX walks by 0x20; 429 T", () => {
  const m = run(loc_129e);
  assert.equal(m.cycles, 429, "sum of the enabled-path T-states");
  assert.deepEqual(m.calls, [0x12b6, 0x12b6, 0x12b6, 0x12b6, 0x12b6, 0x12b6, 0x12b6], "7 per-entry tests");
  assert.equal(m.regs.ix, 0x43b0, "IX = 0x42d0 + 7*0x20");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_129e.js
//   find: regs.de = 0x0020;
//   repl: regs.de = 0x0010;   (wrong struct stride)
//   expect: FAIL (IX ends at 0x4340, not 0x43b0; caught by the IX assert)
test("loc_129e: the contract catches a wrong struct stride", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x4200); m.step(0x12a1, 13);
    regs.rrca(); m.step(0x12a2, 4);
    if (regs.fNC) { m.ret(11); return; }
    m.step(0x12a3, 5);
    regs.ix = 0x42d0; m.step(0x12a7, 14);
    regs.de = 0x0010; m.step(0x12aa, 10); // MUTANT: wrong stride
    regs.b = 0x07; m.step(0x12ac, 7);
    for (;;) {
      regs.exx(); m.step(0x12ad, 4);
      m.push16(0x12b0); m.step(0x12b6, 17); m.call(0x12b6);
      regs.exx(); m.step(0x12b1, 4);
      regs.addIx(regs.de); m.step(0x12b3, 15);
      if (regs.djnz() !== 0) { m.step(0x12ac, 13); continue; }
      m.step(0x12b5, 8);
      break;
    }
    m.ret();
  };
  const m = run(mutant);
  assert.throws(() => assert.equal(m.regs.ix, 0x43b0));
});
