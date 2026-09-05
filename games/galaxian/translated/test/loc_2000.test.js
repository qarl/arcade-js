// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2000 (Galaxian game-loop entry, ROM 0x2000-0x2004):
//   2000  21 a2 40  ld hl,0x40a2   ; scratch region base
//   2003  06 1e     ld b,0x1e      ; clear count
// Contract: 2 instr, 17 T (10+7), HL=0x40a2, B=0x1e, fall-through delegates to loc_2005.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2000 } from "../loc_2000.js";

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
  assert.equal(m.cycles, 17, "T-state total (10+7)");
  assert.deepEqual(m.calls, [0x2005], "falls into the clear loop 0x2005");
  assert.equal(ret, "TAIL", "the fall-through callee result propagates");
  assert.equal(m.regs.hl, 0x40a2, "HL = scratch region base");
  assert.equal(m.regs.b, 0x1e, "B = 30-byte clear count");
}

test("loc_2000: seeds HL/B and tail-delegates to loc_2005; 17 T", () => {
  const m = mk({ 0x2005: "tail" });
  checkSpec(m, loc_2000(m));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2000.js
//   find: regs.b = 0x1e;
//   repl: regs.b = 0x1f;
//   expect: FAIL  (wrong clear count, caught by regs.b == 0x1e)
test("loc_2000: the contract catches a wrong clear count", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x40a2; m.step(0x2003, 10);
    regs.b = 0x1f; m.step(0x2005, 7); // MUTANT
    return m.call(0x2005);
  };
  const m = mk({ 0x2005: "tail" });
  assert.throws(() => checkSpec(m, mutant(m)));
});
