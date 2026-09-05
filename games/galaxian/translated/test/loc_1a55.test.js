// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a55 (Galaxian cold-boot RAM/latch-wipe entry, ROM 0x1A55-0x1A59):
//   1a55  21 00 50  ld hl,0x5000  ; VRAM base
//   1a58  06 04     ld b,0x04     ; four 0x100-byte pages (0x5000-0x53FF)
//   -> fall through to loc_1a5a (separate routine, the VRAM-clear page top)
// Contract: HL=0x5000, B=4, then tail-calls loc_1a5a; 17 T (10+7).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a55 } from "../loc_1a55.js";

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

function run(fn, stubs = { 0x1a5a: "tail" }) {
  const m = mk(stubs);
  m.regs.hl = 0x0000; m.regs.b = 0x00; // arbitrary pre-state
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, hl: m.regs.hl, b: m.regs.b };
}

function checkSpec(res) {
  assert.equal(res.cycles, 17, "T-state total (ld hl,nn 10 + ld b,n 7)");
  assert.deepEqual(res.calls, [0x1a5a], "tail-calls loc_1a5a (the VRAM-clear page top)");
  assert.equal(res.ret, "TAIL", "the tail-call result propagates out");
  assert.equal(res.hl, 0x5000, "HL=0x5000 (VRAM base)");
  assert.equal(res.b, 0x04, "B=4 (four 0x100-byte pages)");
}

test("loc_1a55: seeds HL=0x5000 / B=4, tail-calls loc_1a5a; 17 T", () => {
  checkSpec(run(loc_1a55));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a55.js
//   find: regs.hl = 0x5000;
//   repl: regs.hl = 0x5100;
//   expect: FAIL  (wrong VRAM base -> HL != 0x5000, caught by the HL assertion)
//   verified-anchor: count == 1  (the sole "regs.hl = 0x5000" in loc_1a55.js)
test("loc_1a55: the contract catches a wrong VRAM base", () => {
  const mutant = (m) => {
    const { regs } = m;
    regs.hl = 0x5100; m.step(0x1a58, 10); // MUTANT: wrong VRAM base
    regs.b = 0x04; m.step(0x1a5a, 7);
    return m.call(0x1a5a);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
