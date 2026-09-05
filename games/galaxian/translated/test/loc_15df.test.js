// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_15df (ROM 0x15df-0x15e2): (HL)<-(DE), inc C, ret. Contract: 28 T, no calls,
// mem[HL]==mem[DE], C bumped by 1.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_15df } from "../loc_15df.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_15df: copies (de)->(hl), inc c; 28 T", () => {
  const m = mk();
  m.push16(0x9999);
  m.mem.write8(0x4300, 0xa5); // source (de)
  m.regs.de = 0x4300;
  m.regs.hl = 0x4310; // dest
  m.regs.c = 0x03;
  loc_15df(m);
  assert.equal(m.cycles, 28, "7+7+4+10");
  assert.deepEqual(m.calls, [], "no sub-calls");
  assert.equal(m.mem.read8(0x4310), 0xa5, "(hl) <- (de)");
  assert.equal(m.regs.a, 0xa5, "A holds the copied byte");
  assert.equal(m.regs.c, 0x04, "inc c");
  assert.equal(m.pc, 0x9999, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_15df.js
//   find: regs.c = regs.inc8(regs.c);
//   repl: (drop it)
//   expect: FAIL (C stays 0x03; caught by the C assert)
test("loc_15df: contract catches a dropped `inc c`", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(regs.de); m.step(0x15e0, 7);
    mem.write8(regs.hl, regs.a); m.step(0x15e1, 7);
    m.step(0x15e2, 4); // MUTANT: dropped inc c
    m.ret();
  };
  const m = mk();
  m.push16(0x9999);
  m.regs.de = 0x4300; m.regs.hl = 0x4310; m.regs.c = 0x03;
  mutant(m);
  assert.throws(() => assert.equal(m.regs.c, 0x04));
});
