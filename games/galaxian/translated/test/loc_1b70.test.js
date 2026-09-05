// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1b70 (ROM checksum preamble, ROM 0x1B70-0x1B78):
//   1b70  cd 5d 1b  call 0x1b5d    ; clear VRAM
//   1b73  21 00 00  ld hl,0x0000   ; checksum reads from ROM start
//   1b76  06 28     ld b,0x28      ; 0x28 pages
//   1b78  af        xor a          ; A=0 running sum
//   -> fall-through into loc_1b79
// Contract: 4 instr, 38 T (17+10+7+4), calls [0x1b5d, 0x1b79], B=0x28, A=0, HL=0, SP balanced,
// tail-result propagates.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1b70 } from "../loc_1b70.js";

function mk(stubs = {}) {
  const routines = new Map();
  for (const [a, k] of Object.entries(stubs)) {
    routines.set(Number(a), k === "tail" ? () => "TAIL" : (mm) => { mm.regs.sp = (mm.regs.sp + 2) & 0xffff; });
  }
  const m = new Machine(new Uint8Array(0x4000), routines);
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400; // stack in work RAM so call pushes land cleanly
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  return m;
}

function run(fn, stubs = { 0x1b5d: "pop", 0x1b79: "tail" }) {
  const m = mk(stubs);
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, b: m.regs.b, hl: m.regs.hl, sp: m.regs.sp };
}

function checkSpec(res) {
  assert.equal(res.cycles, 38, "T-state total (17+10+7+4)");
  assert.deepEqual(res.calls, [0x1b5d, 0x1b79], "call 0x1b5d then fall-through into loc_1b79");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.b, 0x28, "ld b,0x28 -- page count");
  assert.equal(res.a, 0, "xor a -> A=0 running sum");
  assert.equal(res.hl, 0x0000, "ld hl,0x0000 -- ROM start");
  assert.equal(res.sp, 0x4400, "the call's return address is popped by the callee -- SP balanced");
}

test("loc_1b70: clears VRAM, seeds HL/B/A, falls into loc_1b79; 38 T", () => {
  checkSpec(run(loc_1b70));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1b70.js
//   find: m.step(0x1b5d, 17); // call 0x1b5d -- clear VRAM\n  m.call(0x1b5d);
//   repl: m.step(0x1b04, 17); // call 0x1b04\n  m.call(0x1b04);
//   expect: FAIL  (calls == [0x1b04, 0x1b79] != [0x1b5d, 0x1b79])
//   verified-anchor: count == 1  (the sole "m.call(0x1b5d)" in loc_1b70.js)
test("loc_1b70: the contract catches a wrong call target", () => {
  const mutant = (m) => {
    const { regs } = m;
    m.push16(0x1b73);
    m.step(0x1b04, 17); // MUTANT: wrong VRAM-clear target
    m.call(0x1b04);
    regs.hl = 0x0000; m.step(0x1b76, 10);
    regs.b = 0x28; m.step(0x1b78, 7);
    regs.xor(regs.a); m.step(0x1b79, 4);
    return m.call(0x1b79);
  };
  assert.throws(() => checkSpec(run(mutant, { 0x1b04: "pop", 0x1b79: "tail" })));
});
