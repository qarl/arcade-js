// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1aff (VRAM march-test fail entry, ROM 0x1aff-0x1b03):
//   1aff  cd 5d 1b  call 0x1b5d    ; fail-side helper (return address 0x1b02)
//   1b02  3e 02     ld a,0x02      ; fail code 2
//   (falls through into loc_1b04)
// Contract: 2 instr + a call, 24 T (17+7), A=2, m.call sequence [0x1b5d, 0x1b04]; the fall-through into
// 0x1b04 propagates its result out.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1aff } from "../loc_1aff.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; // ROM sets SP here; the call push lands in work RAM (0x43fe/0x43ff)
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(res) {
  assert.equal(res.cycles, 24, "T-state total (call 17 + ld 7)");
  assert.deepEqual(res.calls, [0x1b5d, 0x1b04], "call 0x1b5d, then fall through into 0x1b04");
  assert.equal(res.ret, "TAIL", "the fall-through into 0x1b04 propagates its result out");
  assert.equal(res.a, 0x02, "ld a,0x02 -> A=2 (fail code)");
}

function run(fn, stubs = { 0x1b5d: "call", 0x1b04: "tail" }) {
  const m = mk(stubs);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a };
}

test("loc_1aff: calls 0x1b5d, sets fail code 2, falls into 0x1b04; 24 T", () => {
  checkSpec(run(loc_1aff));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1aff.js
//   find: m.step(0x1b5d, 17);\n  m.call(0x1b5d);
//   repl: m.step(0x1b5e, 17);\n  m.call(0x1b5e);
//   expect: FAIL  (calls 0x1b5e -- caught by calls == [0x1b5d, 0x1b04])
//   verified-anchor: count == 1  (the sole "m.call(0x1b5d)" in loc_1aff.js)
test("loc_1aff: the contract catches a wrong call target", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x1b02);
    m.step(0x1b5e, 17); // MUTANT: wrong call target
    m.call(0x1b5e);
    regs.a = 0x02;
    m.step(0x1b04, 7);
    return m.call(0x1b04);
  };
  assert.throws(() => checkSpec(run(mutant, { 0x1b5e: "call", 0x1b04: "tail" })));
});
