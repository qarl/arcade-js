// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_214a (ROM 0x214a-0x214d):
//   214a  eb        ex de,hl
//   214b  c3 85 25  jp 0x2585
// Contract: 14 T (4+10), calls [0x2585], DE<->HL swapped, tail propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_214a } from "../loc_214a.js";

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

function run(fn) {
  const m = mk({ 0x2585: "tail" });
  m.regs.de = 0xaaaa; m.regs.hl = 0xbbbb;
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, de: m.regs.de, hl: m.regs.hl };
}

function checkSpec(res) {
  assert.equal(res.cycles, 14, "T-total (4+10)");
  assert.deepEqual(res.calls, [0x2585], "tail-jump to 0x2585");
  assert.equal(res.ret, "TAIL", "tail result propagates");
  assert.equal(res.de, 0xbbbb, "ex de,hl put HL into DE");
  assert.equal(res.hl, 0xaaaa, "ex de,hl put DE into HL");
}

test("loc_214a: ex de,hl then tail-jump 0x2585; 14 T", () => {
  checkSpec(run(loc_214a));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_214a.js
//   find: m.step(0x2585, 10); // jp 0x2585\n  return m.call(0x2585);
//   repl: m.step(0x2586, 10); // jp 0x2585\n  return m.call(0x2586);
//   expect: FAIL (calls == [0x2586] != [0x2585])
test("loc_214a: contract catches a wrong tail-jump target", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.exDeHl(); m.step(0x214b, 4);
    m.step(0x2586, 10); return m.call(0x2586); // MUTANT
  };
  const m = mk({ 0x2586: "tail" });
  m.regs.de = 0xaaaa; m.regs.hl = 0xbbbb;
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x2585]));
});
