// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b5d (ROM 0x1B5D-0x1B61):
//   1b5d  21 00 50  ld hl,0x5000   ; VRAM base
//   1b60  06 04     ld b,0x04      ; 4 pages
//   (fall into loc_1b62)
// Contract: 2 instr, 17 T (10+7), HL=0x5000, B=4, falls into loc_1b62 (via m.call, result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b5d } from "../loc_1b5d.js";

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
  assert.equal(res.cycles, 17, "T-state total (ld hl,nn 10 + ld b,n 7)");
  assert.deepEqual(res.calls, [0x1b62], "falls into loc_1b62");
  assert.equal(res.ret, "TAIL", "loc_1b62's result propagates out");
  assert.equal(res.hl, 0x5000, "ld hl,0x5000 (VRAM base)");
  assert.equal(res.b, 0x04, "ld b,0x04 (page count)");
}

function run(fn, stubs = { 0x1b62: "tail" }) {
  const m = mk(stubs);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl, b: m.regs.b };
}

test("loc_1b5d: sets HL=0x5000, B=4, falls into loc_1b62; 17 T", () => {
  checkSpec(run(loc_1b5d));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b5d.js
//   find: m.step(0x1b62, 7); // ld b,0x04 -- ...; fall into loc_1b62\n\n  return m.call(0x1b62);
//   repl: m.step(0x1b64, 7); ...  return m.call(0x1b64);
//   expect: FAIL  (skips loc_1b62's A load -- caught by calls == [0x1b62])
//   verified-anchor: count == 1  (the sole "return m.call(0x1b62)" in loc_1b5d.js)
test("loc_1b5d: the contract catches a wrong fall-through target", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x5000;
    m.step(0x1b60, 10);
    regs.b = 0x04;
    m.step(0x1b64, 7); // MUTANT: skips loc_1b62
    return m.call(0x1b64);
  };
  assert.throws(() => checkSpec(run(mutant, { 0x1b64: "tail" })));
});
