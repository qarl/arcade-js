// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0336 (ROM 0x0336-0x0340): advance the 0x4008 sub-timer.
//   0336 21 08 40   ld hl,0x4008
//   0339 35 / 033a c0   dec (0x4008); ret nz  -- still counting
//   033b 36 3c / 033d 2c / 033e c3 31 03   reload 0x4008=0x3c; HL=0x4009; jp loc_0331 (cascade)
// Contracts: counting 32 T (ret nz); wrap 50 T -> tail-jump loc_0331.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0336 } from "../loc_0336.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x43f0;
  m.mem.write8(0x43f0, 0x00); m.mem.write8(0x43f1, 0x20); // caller return = 0x2000
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0336: sub-timer still counting -> ret nz; 32 T", () => {
  const m = mk();
  m.mem.write8(0x4008, 5); // dec -> 4, nonzero
  loc_0336(m);
  assert.equal(m.cycles, 32, "10 + 11 + 11");
  assert.deepEqual(m.calls, [], "no cascade");
  assert.equal(m.mem.read8(0x4008), 4, "0x4008 decremented");
  assert.equal(m.pc, 0x2000, "ret nz returned to caller");
});

function checkWrap(m, ret) {
  assert.equal(m.cycles, 50, "10 + 11 + 5 + 10 + 4 + 10");
  assert.deepEqual(m.calls, [0x0331], "tail-jumps into loc_0331");
  assert.equal(ret, "TAIL", "tail-call result propagates");
  assert.equal(m.mem.read8(0x4008), 0x3c, "0x4008 reloaded to 0x3c");
  assert.equal(m.regs.hl, 0x4009, "HL advanced to 0x4009");
}

test("loc_0336: sub-timer wraps -> reload + jp loc_0331; 50 T", () => {
  const m = mk({ 0x0331: "tail" });
  m.mem.write8(0x4008, 1); // dec -> 0
  const ret = loc_0336(m);
  checkWrap(m, ret);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0336.js
//   find: mem.write8(regs.hl, 0x3c);
//   repl: mem.write8(regs.hl, 0x30);
//   expect: FAIL (0x4008 reloads to 0x30, not 0x3c)
test("loc_0336: the contract catches a wrong reload constant", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.hl = 0x4008; m.step(0x0339, 10);
    regs.decMem8(mem, regs.hl); m.step(0x033a, 11);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x033b, 5);
    mem.write8(regs.hl, 0x30); m.step(0x033d, 10); // MUTANT
    regs.l = regs.inc8(regs.l); m.step(0x033e, 4);
    m.step(0x0331, 10);
    return m.call(0x0331);
  };
  const m = mk({ 0x0331: "tail" });
  m.mem.write8(0x4008, 1);
  const ret = mutant(m);
  assert.throws(() => checkWrap(m, ret));
});
