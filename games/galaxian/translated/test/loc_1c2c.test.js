// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1c2c (Galaxian, ROM 0x1C2C-0x1C2F): HL=0x5800, A=0, fall through into loc_1c30.
// Contract: 14 T (10+4), HL=0x5800, A=0, tail-transfer into loc_1c30 (result propagates).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1c2c } from "../loc_1c2c.js";

function mk(stubs = { 0x1c30: "tail" }) {
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

function checkSpec(m, ret) {
  assert.equal(m.cycles, 14, "ld hl,nn 10 + xor a 4");
  assert.equal(m.regs.hl, 0x5800, "HL = OBJRAM base");
  assert.equal(m.regs.a, 0x00, "xor a -> A=0");
  assert.deepEqual(m.calls, [0x1c30], "falls through into loc_1c30");
  assert.equal(ret, "TAIL", "the fall-through's callee result propagates out");
}

test("loc_1c2c: sets HL=0x5800, A=0, falls into loc_1c30; 14 T", () => {
  const m = mk();
  m.regs.a = 0x77; // seed non-zero so xor a is observable
  checkSpec(m, loc_1c2c(m));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1c2c.js
//   find: regs.hl = 0x5800;
//   repl: regs.hl = 0x5000;
//   expect: FAIL  (points HL at VRAM not OBJRAM -- caught by HL == 0x5800)
//   verified-anchor: count == 1  (the sole regs.hl assignment in loc_1c2c.js)
test("loc_1c2c: the contract catches a wrong HL base", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x5000; m.step(0x1c2f, 10); // MUTANT: wrong base
    regs.xor(regs.a); m.step(0x1c30, 4);
    return m.call(0x1c30);
  };
  const m = mk();
  m.regs.a = 0x77;
  const ret = mutant(m);
  assert.throws(() => checkSpec(m, ret));
});
