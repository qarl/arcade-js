// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2591 (ROM 0x2591-0x2592): ld a,0x2e then fall-through/delegate into loc_2593.
// Contract: 7 T, A=0x2e, tail into 0x2593 (result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2591 } from "../loc_2591.js";

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

test("loc_2591: seeds A=0x2e, tail-delegates into loc_2593; 7 T", () => {
  const m = mk({ 0x2593: () => "TAIL" });
  const ret = loc_2591(m);
  assert.equal(m.cycles, 7, "ld a,n = 7 T");
  assert.deepEqual(m.calls, [0x2593], "delegates to loc_2593");
  assert.equal(m.regs.a, 0x2e, "tile seed");
  assert.equal(ret, "TAIL", "delegate result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2591.js
//   find: regs.a = 0x2e;
//   repl: regs.a = 0x2d;
//   expect: FAIL (wrong tile seed; caught by the A assert)
test("loc_2591: the contract catches a wrong tile seed", () => {
  const mutant = (m) => { m.regs.a = 0x2d; m.step(0x2593, 7); return m.call(0x2593); };
  const m = mk({ 0x2593: () => "TAIL" });
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x2e));
});
