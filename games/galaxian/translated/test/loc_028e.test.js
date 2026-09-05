// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_028e (ROM 0x028e-0x029c): four per-frame updates then tail-jp 0x0336.
// Contract: 78 T (17*4 + 10), calls [0x0363,0x0bbe,0x0cc3,0x0367,0x0336].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_028e } from "../loc_028e.js";

const popret = (mm) => { mm.pop16(); };
const noop = () => {};

function mk(stubs) {
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

function run(fn) {
  const m = mk({ 0x0363: popret, 0x0bbe: popret, 0x0cc3: popret, 0x0367: popret, 0x0336: noop });
  m.push16(0x9999);
  fn(m);
  return m;
}

test("loc_028e: four updates then tail-jp 0x0336; 78 T", () => {
  const m = run(loc_028e);
  assert.equal(m.cycles, 78, "17*4 + jp 10");
  assert.deepEqual(m.calls, [0x0363, 0x0bbe, 0x0cc3, 0x0367, 0x0336], "updates then tail-jp 0x0336");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_028e.js
//   find: m.step(0x0336, 10);\n  return m.call(0x0336);
//   repl: m.step(0x0337, 10);\n  return m.call(0x0337);
//   expect: FAIL (tail-jumps 0x0337 -- caught by the calls array)
test("loc_028e: the contract catches a wrong tail-jump target", () => {
  const mutant = (m) => {
    m.push16(0x0291); m.step(0x0363, 17); m.call(0x0363);
    m.push16(0x0294); m.step(0x0bbe, 17); m.call(0x0bbe);
    m.push16(0x0297); m.step(0x0cc3, 17); m.call(0x0cc3);
    m.push16(0x029a); m.step(0x0367, 17); m.call(0x0367);
    m.step(0x0337, 10); return m.call(0x0337); // MUTANT: wrong target
  };
  const m = mk({ 0x0363: popret, 0x0bbe: popret, 0x0cc3: popret, 0x0367: popret, 0x0337: noop });
  m.push16(0x9999);
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x0363, 0x0bbe, 0x0cc3, 0x0367, 0x0336]));
});
