// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_096f (ROM 0x096f-0x0971): A = -L, then fall through to genuine loc_0972.
// Contract: 12 T, A = (-L)&0xff, calls [0x0972].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_096f } from "../loc_096f.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map([[0x0972, () => {}]]));
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_096f: A = -L then delegates to loc_0972; 12 T", () => {
  const m = mk();
  m.regs.l = 0x30;
  loc_096f(m);
  assert.equal(m.cycles, 12, "ld a,l (4) + neg (8)");
  assert.equal(m.regs.a, 0xd0, "neg: -0x30 = 0xD0");
  assert.deepEqual(m.calls, [0x0972], "fall-through delegate to loc_0972");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_096f.js
//   find: regs.neg();\n  m.step(0x0972, 8); // neg -- A = -L
//   repl: m.step(0x0972, 4); (drop the negate)
//   expect: FAIL (A stays 0x30, cycles 8; caught by the A + cycles asserts)
test("loc_096f: the contract catches a dropped negate", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.a = regs.l; m.step(0x0970, 4);
    m.step(0x0972, 4); // MUTANT: dropped neg
    return m.call(0x0972);
  };
  const m = mk();
  m.regs.l = 0x30;
  mutant(m);
  assert.throws(() => {
    assert.equal(m.regs.a, 0xd0);
    assert.equal(m.cycles, 12);
  });
});
