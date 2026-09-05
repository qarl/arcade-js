// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1472 (ROM 0x1472-0x148d): spawn primary struct 0x42d0 (loc_145c), back HL up by
// 0x0F, then walk B=3 trigger flags downward calling loc_148e on each set bit0. Interior loop loc_1485
// inlined. Deterministic path: HL=0x4130 (->0x4121 after sub), flags 0x4121/0x411f set, 0x4120 clear.
//   calls [0x145c, 0x148e, 0x148e]; T = 74 + 46 + 39 + 41 + 10 = 210.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1472 } from "../loc_1472.js";

function mk() {
  const routines = new Map();
  // Both callees ret (loc_145c tail-jumps loc_08f2 which rets); stubs pop the pushed return addr to balance.
  const popStub = (mm) => { mm.pop16(); };
  routines.set(0x145c, popStub);
  routines.set(0x148e, popStub);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run() {
  const m = mk();
  m.regs.hl = 0x4130; // l=0x30 -> 0x21 after sub 0x0f
  m.mem.write8(0x4121, 0x01); // trigger set
  m.mem.write8(0x4120, 0x00); // trigger clear
  m.mem.write8(0x411f, 0x01); // trigger set
  m.push16(0x9999);
  loc_1472(m);
  return m;
}

test("loc_1472: primary spawn + walks 3 triggers, two set -> two loc_148e; 210 T", () => {
  const m = run();
  assert.equal(m.cycles, 210, "setup 74 + loop 46+39+41 + ret 10");
  assert.deepEqual(m.calls, [0x145c, 0x148e, 0x148e], "primary spawn then two set-bit propagations");
  assert.equal(m.regs.ix, 0x42d0, "IX = primary struct");
  assert.equal(m.regs.iy, 0x42f0, "IY = secondary slot base (loc_148e stubbed, no advance)");
  assert.equal(m.regs.c, 0x02, "C=2 budget set (loc_148e stubbed, no dec)");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1472.js
//   find: regs.b = 0x03;
//   repl: regs.b = 0x02;  (walks only 2 triggers, misses the third set bit)
//   expect: FAIL  (calls become [0x145c,0x148e], caught by the calls + T-state asserts)
test("loc_1472: the contract catches a short trigger walk", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.ix = 0x42d0; m.step(0x1476, 14);
    m.push16(0x1479); m.step(0x145c, 17); m.call(0x145c);
    regs.a = regs.l; m.step(0x147a, 4);
    regs.sub(0x0f); m.step(0x147c, 7);
    regs.l = regs.a; m.step(0x147d, 4);
    regs.iy = 0x42f0; m.step(0x1481, 14);
    regs.b = 0x02; m.step(0x1483, 7); // MUTANT: only 2 iterations
    regs.c = 0x02; m.step(0x1485, 7);
    for (;;) {
      regs.bit(0, mem.read8(regs.hl)); m.step(0x1487, 12);
      if (regs.fNZ) { m.push16(0x148a); m.step(0x148e, 17); m.call(0x148e); }
      else { m.step(0x148a, 10); }
      regs.l = regs.dec8(regs.l); m.step(0x148b, 4);
      if (regs.djnz() !== 0) { m.step(0x1485, 13); continue; }
      m.step(0x148d, 8); break;
    }
    m.ret();
  };
  const m = mk();
  m.regs.hl = 0x4130;
  m.mem.write8(0x4121, 0x01); m.mem.write8(0x4120, 0x00); m.mem.write8(0x411f, 0x01);
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x145c, 0x148e, 0x148e]));
});
