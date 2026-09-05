// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_205e (ROM 0x205e-0x2066):
//   205e  cd e1 20  call 0x20e1
//   2061  da 83 25  jp c,0x2583
//   2064  c3 a7 25  jp 0x25a7
// Contract: call 0x20e1; carry -> tail-jp 0x2583 (17+10=27 T), no-carry -> tail-jp 0x25a7 (17+10+10=37 T).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_205e } from "../loc_205e.js";

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

// 0x20e1 is a NON-tail call: pop its pushed return, then leave carry per the scenario.
const sub20e1 = (carry) => (mm) => { mm.pop16(); mm.regs.fC = carry; };
const tail = () => "TAIL";

test("loc_205e no-carry: call 0x20e1 then tail-jp 0x25a7; 37 T", () => {
  const m = mk({ 0x20e1: sub20e1(false), 0x25a7: tail, 0x2583: tail });
  const ret = loc_205e(m);
  assert.equal(m.cycles, 37, "17(call)+10(jp c not taken)+10(jp)");
  assert.deepEqual(m.calls, [0x20e1, 0x25a7]);
  assert.equal(ret, "TAIL", "0x25a7 result propagates");
});

test("loc_205e carry: call 0x20e1 then tail-jp 0x2583; 27 T", () => {
  const m = mk({ 0x20e1: sub20e1(true), 0x25a7: tail, 0x2583: tail });
  const ret = loc_205e(m);
  assert.equal(m.cycles, 27, "17(call)+10(jp c taken)");
  assert.deepEqual(m.calls, [0x20e1, 0x2583]);
  assert.equal(ret, "TAIL", "0x2583 result propagates");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_205e.js
//   find: if (regs.fC) {
//   repl: if (regs.fNC) {
//   expect: FAIL (inverted branch routes no-carry to 0x2583 -- caught by calls == [0x20e1, 0x25a7])
test("loc_205e: the contract catches an inverted carry branch", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x2061); m.step(0x20e1, 17); m.call(0x20e1);
    if (regs.fNC) { m.step(0x2583, 10); return m.call(0x2583); } // MUTANT
    m.step(0x2064, 10);
    m.step(0x25a7, 10); return m.call(0x25a7);
  };
  const m = mk({ 0x20e1: sub20e1(false), 0x25a7: tail, 0x2583: tail });
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x20e1, 0x25a7]));
});
