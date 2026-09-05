// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b62 (ROM 0x1B62-0x1B63):
//   1b62  3e 10     ld a,0x10      ; blank-tile fill byte
//   (fall into loc_1b64)
// Contract: 1 instr, 7 T, A=0x10, falls into loc_1b64 (via m.call, result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b62 } from "../loc_1b62.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : () => {});
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function checkSpec(res) {
  assert.equal(res.cycles, 7, "T-state total (ld a,n 7)");
  assert.deepEqual(res.calls, [0x1b64], "falls into loc_1b64");
  assert.equal(res.ret, "TAIL", "loc_1b64's result propagates out");
  assert.equal(res.a, 0x10, "ld a,0x10 (blank-tile fill byte)");
}

function run(fn, stubs = { 0x1b64: "tail" }) {
  const m = mk(stubs);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a };
}

test("loc_1b62: sets A=0x10, falls into loc_1b64; 7 T", () => {
  checkSpec(run(loc_1b62));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b62.js
//   find: regs.a = 0x10;
//   repl: regs.a = 0x11;
//   expect: FAIL  (wrong fill byte -- caught by a == 0x10)
//   verified-anchor: count == 1  (the sole "regs.a = 0x10" in loc_1b62.js)
test("loc_1b62: the contract catches a wrong fill byte", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.a = 0x11; // MUTANT: wrong tile
    m.step(0x1b64, 7);
    return m.call(0x1b64);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
