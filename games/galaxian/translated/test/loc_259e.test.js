// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_259e (ROM 0x259e-0x259f): ld a,0x2c then fall-through/delegate into loc_25a0.
// Contract: 7 T, A=0x2c, tail into 0x25a0 (result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_259e } from "../loc_259e.js";

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

test("loc_259e: seeds A=0x2c, tail-delegates into loc_25a0; 7 T", () => {
  const m = mk({ 0x25a0: () => "TAIL" });
  const ret = loc_259e(m);
  assert.equal(m.cycles, 7, "ld a,n = 7 T");
  assert.deepEqual(m.calls, [0x25a0], "delegates to loc_25a0");
  assert.equal(m.regs.a, 0x2c, "tile seed");
  assert.equal(ret, "TAIL", "delegate result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_259e.js
//   find: regs.a = 0x2c;
//   repl: regs.a = 0x2b;
//   expect: FAIL (wrong tile seed; caught by the A assert)
test("loc_259e: the contract catches a wrong tile seed", () => {
  const mutant = (m) => { m.regs.a = 0x2b; m.step(0x25a0, 7); return m.call(0x25a0); };
  const m = mk({ 0x25a0: () => "TAIL" });
  mutant(m);
  assert.throws(() => assert.equal(m.regs.a, 0x2c));
});
