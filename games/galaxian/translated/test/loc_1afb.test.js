// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1afb (work-RAM march-test fail entry, ROM 0x1afb-0x1afe):
//   1afb  3e 01     ld a,0x01      ; fail code 1
//   1afd  18 05     jr 0x1b04      ; -> shared result reporter
// Contract: 2 instr, 19 T (7+12), A=1, unconditional tail m.call [0x1b04].

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1afb } from "../loc_1afb.js";

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

function checkSpec(res) {
  assert.equal(res.cycles, 19, "T-state total (7+12)");
  assert.deepEqual(res.calls, [0x1b04], "tail-jumps into the shared reporter 0x1b04");
  assert.equal(res.ret, "TAIL", "the tail-jump's callee result propagates out");
  assert.equal(res.a, 0x01, "ld a,0x01 -> A=1 (fail code)");
}

function run(fn, stubs = { 0x1b04: "tail" }) {
  const m = mk(stubs);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a };
}

test("loc_1afb: loads fail code 1 and tail-jumps 0x1b04; 19 T", () => {
  checkSpec(run(loc_1afb));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1afb.js
//   find: m.step(0x1b04, 12);\n  return m.call(0x1b04);
//   repl: m.step(0x1b05, 12);\n  return m.call(0x1b05);
//   expect: FAIL  (jr jumps to 0x1b05 -- caught by calls == [0x1b04])
//   verified-anchor: count == 1  (the sole "return m.call(0x1b04)" in loc_1afb.js)
test("loc_1afb: the contract catches a wrong jr target", () => {
  const mutant = (m) => {
    m.regs.a = 0x01;
    m.step(0x1afd, 7);
    m.step(0x1b05, 12); // MUTANT: wrong target
    return m.call(0x1b05);
  };
  assert.throws(() => checkSpec(run(mutant, { 0x1b05: "tail" })));
});
