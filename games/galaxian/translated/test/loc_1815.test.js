// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1815 (ROM 0x1815-0x1818):
//   1815  32 c1 41  ld (0x41c1),a   ; pitch source
//   1818  c9        ret
// Contract: 23 T (13+10), 0x41c1 = A, ret to the caller.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1815 } from "../loc_1815.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  return m;
}

test("loc_1815: store A -> 0x41c1, ret; 23 T", () => {
  const m = mk();
  m.regs.a = 0x77;
  loc_1815(m);
  assert.equal(m.cycles, 23, "13 + 10");
  assert.equal(m.mem.read8(0x41c1), 0x77, "0x41c1 = A");
  assert.equal(m.pc, 0x1234, "ret popped the caller's return");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1815.js
//   find: mem.write8(0x41c1, regs.a);
//   repl: mem.write8(0x41c0, regs.a);
//   expect: FAIL (writes the wrong cell; 0x41c1 stays 0, caught by the assert)
test("loc_1815: the contract catches the wrong destination cell", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(0x41c0, regs.a); m.step(0x1818, 13); // MUTANT
    return m.ret();
  };
  const m = mk();
  m.regs.a = 0x77;
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x41c1), 0x77));
});
