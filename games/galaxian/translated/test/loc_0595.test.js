// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0595 (ROM 0x0595-0x0597): ld hl,0x1d71; delegate to loc_0598.
// Contract: 10 T, calls [0x0598], HL = 0x1d71 (the copy source loc_0598 reads).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0595 } from "../loc_0595.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map([[0x0598, () => {}]]));
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_0595: HL = 0x1d71, delegate to loc_0598; 10 T", () => {
  const m = mk();
  loc_0595(m);
  assert.equal(m.cycles, 10, "ld hl,nn");
  assert.deepEqual(m.calls, [0x0598], "delegates to loc_0598");
  assert.equal(m.regs.hl, 0x1d71, "HL = copy source 0x1d71");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0595.js
//   find: regs.hl = 0x1d71;   repl: regs.hl = 0x1d70;   (wrong source)
//   expect: FAIL (HL != 0x1d71)
test("loc_0595: contract catches a wrong source address", () => {
  const m = mk();
  m.regs.hl = 0x1d70; m.step(0x0598, 10); m.call(0x0598); // MUTANT
  assert.throws(() => assert.equal(m.regs.hl, 0x1d71));
});
