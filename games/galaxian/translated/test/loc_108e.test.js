// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_108e (ROM 0x108e-0x1090): a lone `jp 0x0d71`. Contract: 10 T, tail-calls 0x0d71.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_108e } from "../loc_108e.js";

const noop = () => {};

function mk() {
  const routines = new Map([[0x0d71, noop], [0x0d72, noop]]);
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

test("loc_108e: tail-jumps to 0x0d71; 10 T", () => {
  const m = mk();
  loc_108e(m);
  assert.deepEqual(m.calls, [0x0d71], "jp 0x0d71 tail-call");
  assert.equal(m.pc, 0x0d71, "pc lands on the tail target");
  assert.equal(m.cycles, 10, "jp = 10 T");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_108e.js
//   find: m.step(0x0d71, 10); return m.call(0x0d71);   repl: 0x0d72
//   expect: FAIL (jumps to the wrong handler)
test("loc_108e: contract catches a wrong tail target", () => {
  const m = mk();
  const mutant = (mm) => { mm.step(0x0d72, 10); return mm.call(0x0d72); };
  mutant(m);
  assert.throws(() => assert.equal(m.pc, 0x0d71));
});
