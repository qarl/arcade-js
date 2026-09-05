// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1446 (ROM 0x1446-0x145b): free-slot finder over 0x4390 down (stride -0x20, B=4).
// Path here: slot 0 occupied, slot 1 empty -> IX steps to 0x4370, tail-jumps to seeder 0x145c. Contract:
// 154 T, calls [0x145c], IX left at the empty slot.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1446 } from "../loc_1446.js";

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

test("loc_1446: slot 0 busy, slot 1 free -> IX=0x4370, tail to 0x145c; 154 T", () => {
  const m = mk({ 0x145c: () => {} });
  m.mem.write8(0x4391, 0x05); // (ix+1) of slot 0 non-zero -> occupied
  m.push16(0x9999);
  loc_1446(m);
  assert.deepEqual(m.calls, [0x145c], "jr z,0x145c -- tail to the seeder");
  assert.equal(m.regs.ix, 0x4370, "IX stepped one slot down (-0x20) to the empty slot");
  assert.equal(m.cycles, 154, "ld ix/de/b + one full miss + the hit");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1446.js
//   find: regs.or(mem.read8(regs.ix + 0x01));
//   repl: drop it (only (ix+0) tested)
//   expect: FAIL -- slot 0 reads empty on (ix+0) alone, so it delegates at IX=0x4390 not 0x4370;
//           caught by the IX assert.
test("loc_1446: the contract catches an (ix+1) half-test of the slot pair", () => {
  const m = mk({ 0x145c: () => {} });
  m.mem.write8(0x4391, 0x05); // only the (ix+1) byte marks slot 0 busy
  m.push16(0x9999);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.ix = 0x4390; mm.step(0x144a, 14);
    regs.de = 0xffe0; mm.step(0x144d, 10);
    regs.b = 0x04; mm.step(0x144f, 7);
    for (;;) {
      regs.a = mem.read8(regs.ix + 0x00); mm.step(0x1452, 19);
      // MUTANT: dropped `or (ix+1)` -- flags come from (ix+0) alone
      mm.step(0x1455, 19);
      if (regs.a === 0) { mm.step(0x145c, 12); return mm.call(0x145c); }
      mm.step(0x1457, 7);
      regs.addIx(regs.de); mm.step(0x1459, 15);
      if (regs.djnz() !== 0) { mm.step(0x144f, 13); continue; }
      mm.step(0x145b, 8);
      break;
    }
    mm.ret();
  };
  mutant(m);
  assert.throws(() => assert.equal(m.regs.ix, 0x4370));
});
