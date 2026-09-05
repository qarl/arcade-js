// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_050f (ROM 0x050f-0x0514): (0x41b5) <- 3, ret. Contract 30 T (7+13+10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_050f } from "../loc_050f.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}

test("loc_050f: (0x41b5) <- 3, ret; 30 T", () => {
  const m = mk();
  m.push16(0x9999);
  loc_050f(m);
  assert.equal(m.cycles, 30, "7+13+10");
  assert.equal(m.mem.read8(0x41b5), 0x03, "(0x41b5) <- 3");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_050f.js
//   find: mem.write8(0x41b5, regs.a);
//   repl: mem.write8(0x41b6, regs.a);
//   expect: FAIL (writes the wrong cell; 0x41b5 stays 0)
test("loc_050f: the contract catches a wrong target cell", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = 0x03; m.step(0x0511, 7);
    mem.write8(0x41b6, regs.a); m.step(0x0514, 13); // MUTANT: wrong cell
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read8(0x41b5), 0x03));
});
