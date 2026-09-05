// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2231 (ROM 0x2231-0x2255): select the WRAM BCD source (DE) for counter index A, then
// tail into loc_2256. Index-0 path (A=0): cp 0x03 (C set) -> jr nc not taken -> and a (Z) -> DE=0x40a4 ->
// jr z,0x2256 taken. Contract: 40 T (7+7+4+10+12), calls [0x2256], DE=0x40a4, delegate result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2231 } from "../loc_2231.js";

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

test("loc_2231: index 0 selects DE=0x40a4 and tail-jumps loc_2256; 40 T", () => {
  const m = mk({ 0x2256: () => "REND" });
  m.regs.a = 0;
  const ret = loc_2231(m);
  assert.equal(m.cycles, 40, "7+7+4+10+12");
  assert.deepEqual(m.calls, [0x2256], "delegates to the digit render");
  assert.equal(m.regs.de, 0x40a4, "BCD source for index 0");
  assert.equal(ret, "REND", "the tail-jump's callee result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2231.js
//   find: regs.de = 0x40a4; // BCD source for index 0
//   repl: regs.de = 0x40a7; // WRONG source
//   expect: FAIL (DE assert sees 0x40a7)
test("loc_2231: the contract catches a wrong index-0 BCD source", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.cp(0x03);
    m.step(0x2233, 7);
    m.step(0x2235, 7);
    regs.and(regs.a);
    m.step(0x2236, 4);
    regs.de = 0x40a7; // MUTANT: wrong source
    m.step(0x2239, 10);
    m.step(0x2256, 12);
    return m.call(0x2256);
  };
  const m = mk({ 0x2256: () => "REND" });
  m.regs.a = 0;
  mutant(m);
  assert.throws(() => assert.equal(m.regs.de, 0x40a4));
});
