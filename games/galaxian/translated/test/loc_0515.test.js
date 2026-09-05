// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0515 (ROM 0x0515-0x051a): (0x4195) <- 3, ret. Contract 30 T (7+13+10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0515 } from "../loc_0515.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}

test("loc_0515: (0x4195) <- 3, ret; 30 T", () => {
  const m = mk();
  m.push16(0x9999);
  loc_0515(m);
  assert.equal(m.cycles, 30, "7+13+10");
  assert.equal(m.mem.read8(0x4195), 0x03, "(0x4195) <- 3");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0515.js
//   find: regs.a = 0x03;
//   repl: regs.a = 0x02;
//   expect: FAIL (stores 2 instead of 3)
test("loc_0515: the contract catches a wrong stored value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = 0x02; m.step(0x0517, 7); // MUTANT: wrong value
    mem.write8(0x4195, regs.a); m.step(0x051a, 13);
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x4195), 0x03));
});
