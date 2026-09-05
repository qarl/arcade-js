// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_032e (ROM 0x032e-0x0330): ld hl,0x4009 then fall through into loc_0331 (delegate).
// Contract: 10 T for its own instr, calls [0x0331] with HL=0x4009.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_032e } from "../loc_032e.js";

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
const cap0331 = (mm) => { mm.hlAt0331 = mm.regs.hl; return "DONE"; };

function run(fn) {
  const m = mk({ 0x0331: cap0331 });
  const ret = fn(m);
  return { m, ret };
}

test("loc_032e: points HL at 0x4009, delegates to loc_0331; 10 T", () => {
  const { m, ret } = run(loc_032e);
  assert.equal(m.cycles, 10, "ld hl,0x4009 = 10 T");
  assert.deepEqual(m.calls, [0x0331], "fall-through delegates to loc_0331");
  assert.equal(m.hlAt0331, 0x4009, "HL = 0x4009 handed to loc_0331");
  assert.equal(ret, "DONE", "loc_0331 result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_032e.js
//   find: regs.hl = 0x4009;
//   repl: regs.hl = 0x4008;
//   expect: FAIL (loc_0331 receives HL=0x4008; caught by the hlAt0331 assert)
test("loc_032e: contract catches a wrong HL handed to loc_0331", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x4008; m.step(0x0331, 10); // MUTANT: wrong cell
    return m.call(0x0331);
  };
  assert.throws(() => assert.equal(run(mutant).m.hlAt0331, 0x4009));
});
