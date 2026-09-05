// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0331 (ROM 0x0331-0x0335): dec (HL); ret nz; else inc l + inc (HL+1); ret.
// Contract: nonzero path 22 T (HL cell--, next cell untouched); zero path 41 T (HL cell=0, next cell++).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0331 } from "../loc_0331.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  return m;
}

function run(fn, cellVal) {
  const m = mk();
  m.regs.hl = 0x4009;
  m.mem.write8(0x4009, cellVal);
  m.mem.write8(0x400a, 0x00);
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_0331: nonzero countdown just decrements + rets; 22 T", () => {
  const m = run(loc_0331, 5);
  assert.equal(m.cycles, 22, "dec (hl) 11 + ret nz taken 11");
  assert.equal(m.mem.read8(0x4009), 4, "0x4009 decremented");
  assert.equal(m.mem.read8(0x400a), 0, "next cell untouched while nonzero");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

test("loc_0331: expiry (dec to 0) bumps the next cell; 41 T", () => {
  const m = run(loc_0331, 1);
  assert.equal(m.cycles, 41, "11 + 5 + 4 + 11 + 10");
  assert.equal(m.mem.read8(0x4009), 0, "0x4009 hit 0");
  assert.equal(m.mem.read8(0x400a), 1, "next cell (0x400a) incremented on expiry");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0331.js
//   find: if (regs.fNZ) {\n    m.ret(11); return;\n  }
//   repl: (drop the guard -- always advance)
//   expect: FAIL (nonzero path would bump 0x400a; caught by "next cell untouched" assert)
test("loc_0331: contract catches a dropped `ret nz` guard", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.decMem8(mem, regs.hl); m.step(0x0332, 11);
    // MUTANT: no ret-nz guard; always advance and bump the next cell
    regs.l = regs.inc8(regs.l); m.step(0x0334, 4);
    regs.incMem8(mem, regs.hl); m.step(0x0335, 11);
    m.ret();
  };
  assert.throws(() => assert.equal(run(mutant, 5).mem.read8(0x400a), 0));
});
