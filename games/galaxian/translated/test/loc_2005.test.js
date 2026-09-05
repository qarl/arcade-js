// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2005 (Galaxian clear loop, ROM 0x2005-0x2009):
//   2005  36 00     ld (hl),0x00
//   2007  23        inc hl
//   2008  10 fb     djnz 0x2005
// Contract (B=2, HL=0x4200): 2 iterations clear 0x4200/0x4201 to 0, HL ends 0x4202, B=0,
//   T = (10+6+13)+(10+6+8) = 53, fall-through delegates to loc_200a.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2005 } from "../loc_2005.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(m, ret) {
  assert.equal(m.cycles, 53, "T-state total (2 iters: 29+24)");
  assert.deepEqual(m.calls, [0x200a], "falls into the dispatch loop 0x200a");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(m.mem.read8(0x4200), 0x00, "first scratch byte cleared");
  assert.equal(m.mem.read8(0x4201), 0x00, "second scratch byte cleared");
  assert.equal(m.regs.hl, 0x4202, "HL advanced past both");
  assert.equal(m.regs.b, 0x00, "B counted down to 0");
}

test("loc_2005: clears B bytes then delegates to loc_200a; 53 T for B=2", () => {
  const m = mk({ 0x200a: "tail" });
  m.mem.write8(0x4200, 0xaa); m.mem.write8(0x4201, 0xbb); // dirty first
  m.regs.hl = 0x4200; m.regs.b = 2;
  checkSpec(m, loc_2005(m));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2005.js
//   find: mem.write8(regs.hl, 0x00);
//   repl: mem.write8(regs.hl, 0x42);
//   expect: FAIL  (fills 0x42 not 0, caught by mem.read8(0x4200) == 0)
test("loc_2005: the contract catches a wrong fill value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, 0x42); m.step(0x2007, 10); // MUTANT
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x2008, 6);
      if (regs.djnz() !== 0) { m.step(0x2005, 13); continue; }
      m.step(0x200a, 8); break;
    }
    return m.call(0x200a);
  };
  const m = mk({ 0x200a: "tail" });
  m.regs.hl = 0x4200; m.regs.b = 2;
  assert.throws(() => checkSpec(m, mutant(m)));
});
