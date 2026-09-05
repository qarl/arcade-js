// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a9a (Galaxian cold-boot work-RAM test setup, ROM 0x1a9a-0x1a9f):
//   1a9a  21 00 40  ld hl,0x4000   ; RAM base
//   1a9d  06 04     ld b,0x04      ; four 0x100-byte pages
//   1a9f  79        ld a,c         ; A = current test seed (C)
//   -> fall through to loc_1aa0 (separate routine, the write/verify inner loop)
// Contract (entry C=0x20): 21 T (10+7+4), exit HL=0x4000 / B=4 / A=0x20 (=C), tail-calls loc_1aa0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a9a } from "../loc_1a9a.js";

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

function run(fn, stubs = { 0x1aa0: "tail" }) {
  const m = mk(stubs);
  m.regs.c = 0x20; m.regs.hl = 0x7009; m.regs.b = 0x00; m.regs.a = 0xff; // arbitrary pre-state
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl, b: m.regs.b, a: m.regs.a };
}

function checkSpec(res) {
  assert.equal(res.cycles, 21, "T-state total (ld hl 10 + ld b 7 + ld a,c 4)");
  assert.deepEqual(res.calls, [0x1aa0], "tail-calls loc_1aa0 (the write/verify loop)");
  assert.equal(res.ret, "TAIL", "the tail-call result propagates out");
  assert.equal(res.hl, 0x4000, "HL=0x4000 (RAM base)");
  assert.equal(res.b, 0x04, "B=4 (page count)");
  assert.equal(res.a, 0x20, "A=C (test seed copied into A)");
}

test("loc_1a9a: seeds HL=0x4000 / B=4 / A=C, tail-calls loc_1aa0; 21 T", () => {
  checkSpec(run(loc_1a9a));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a9a.js
//   find: regs.a = regs.c;
//   repl: regs.a = 0x00;
//   expect: FAIL  (A no longer tracks C -> exit A != 0x20, caught by the A assertion)
//   verified-anchor: count == 1  (the sole "regs.a = regs.c" in loc_1a9a.js)
test("loc_1a9a: the contract catches a dropped A=C copy", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x4000;
    m.step(0x1a9d, 10);
    regs.b = 0x04;
    m.step(0x1a9f, 7);
    regs.a = 0x00; // MUTANT: fails to copy C into A
    m.step(0x1aa0, 4);
    return m.call(0x1aa0);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
