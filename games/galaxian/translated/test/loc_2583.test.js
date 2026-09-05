// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2583 (Galaxian/DK tile-block seed, ROM 0x2583-0x2584):
//   2583  3e 2c  ld a,0x2c   ; seed the first tile code, then fall through into loc_2585
// Contract: 1 instr, 7 T, A=0x2c, delegates (fall-through) to loc_2585.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2583 } from "../loc_2583.js";

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

test("loc_2583: seeds A=0x2c, falls through into loc_2585; 7 T", () => {
  const m = mk({ 0x2585: "tail" });
  const ret = loc_2583(m);
  assert.equal(m.cycles, 7, "ld a,n = 7 T");
  assert.deepEqual(m.calls, [0x2585], "fall-through delegates to loc_2585");
  assert.equal(ret, "TAIL", "the delegate's result propagates out");
  assert.equal(m.regs.a, 0x2c, "A seeded to 0x2c");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2583.js
//   find: regs.a = 0x2c;
//   repl: regs.a = 0x2d;
//   expect: FAIL  (wrong seed -- caught by A == 0x2c)
test("loc_2583: the contract catches a wrong tile seed", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.a = 0x2d; // MUTANT: wrong seed
    m.step(0x2585, 7);
    return m.call(0x2585);
  };
  const m = mk({ 0x2585: "tail" });
  mutant(m);
  assert.notEqual(m.regs.a, 0x2c, "mutant seeded 0x2d -- contract would fail");
});
