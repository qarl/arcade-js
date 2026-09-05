// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_2146 (ROM 0x2146-0x2149):
//   2146  21 5b 21  ld hl,0x215b   ; byte-table base
//   2149  e7        rst 0x20       ; A=(0x215b+A)
//   (falls through into loc_214a)
// Contract: 21 T (10+11), calls [0x0020, 0x214a], HL=0x215b before the rst, rst return 0x214a pushed,
// tail into loc_214a propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_2146 } from "../loc_2146.js";

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
  m.regs.sp = 0x4400;
  return m;
}

function run(fn) {
  const m = mk({ 0x0020: "mid", 0x214a: "tail" });
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl };
}

function checkSpec(res) {
  assert.equal(res.cycles, 21, "T-total (10+11)");
  assert.deepEqual(res.calls, [0x0020, 0x214a], "rst 0x20 then fall-through into loc_214a");
  assert.equal(res.ret, "TAIL", "loc_214a tail result propagates");
  assert.equal(res.hl, 0x215b, "ld hl,0x215b set the table base before the rst");
}

test("loc_2146: indexes 0x215b table then falls into loc_214a; 21 T", () => {
  checkSpec(run(loc_2146));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_2146.js
//   find: return m.call(0x214a); // fall through into loc_214a
//   repl: return m.call(0x214b); // fall through into loc_214a
//   expect: FAIL (calls == [0x0020, 0x214b] != [0x0020, 0x214a])
test("loc_2146: contract catches a wrong fall-through target", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x215b; m.step(0x2149, 10);
    m.push16(0x214a); m.step(0x0020, 11); m.call(0x0020);
    return m.call(0x214b); // MUTANT
  };
  const m = mk({ 0x0020: "mid", 0x214b: "tail" });
  mutant(m);
  assert.throws(() => assert.deepEqual(m.calls, [0x0020, 0x214a]));
});
