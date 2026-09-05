// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1ae4 (Galaxian VIDEORAM march-test read-back loop, ROM 0x1ae4-0x1afa).
// Two exercised paths:
//   MISMATCH: A=0, HL=0x5000 (VRAM reads 0), so add a,0x2f -> 0x2f != (hl)=0 -> jr nz,0x1aff.
//             Contract: 3 instr, 26 T (7+7+12), A=0x2f, tail m.call [0x1aff].
//   FULL PASS: VRAM pre-filled with the exact seed pattern, C=1 -> all 1024 compares pass, watchdog
//             read, dec c -> 0, jp 0x1b70. Contract: tail m.call [0x1b70], no 0x1aff.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1ae4 } from "../loc_1ae4.js";

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

// Fill VRAM 0x5000-0x53FF the way loc_1aca wrote it: seed in A, +0x2F per byte, +1 between the 4 pages.
function fillPattern(m, seed) {
  let a = seed & 0xff;
  for (let page = 0; page < 4; page++) {
    for (let l = 0; l < 256; l++) {
      a = (a + 0x2f) & 0xff;
      m.mem.write8(0x5000 + page * 256 + l, a);
    }
    a = (a + 1) & 0xff; // inc a between pages
  }
}

function runMismatch(fn) {
  const m = mk({ 0x1aff: "tail", 0x1aca: "tail", 0x1b70: "tail" });
  m.regs.a = 0x00; m.regs.hl = 0x5000; m.regs.b = 0x04; m.regs.c = 0x20; // VRAM defaults to 0
  const ret = fn(m);
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, hl: m.regs.hl };
}

function checkMismatch(res) {
  assert.equal(res.cycles, 26, "T-state total of the mismatch path (7+7+12)");
  assert.deepEqual(res.calls, [0x1aff], "mismatch tail-jumps to the fail path 0x1aff");
  assert.equal(res.ret, "TAIL", "the tail-jump's callee result propagates out");
  assert.equal(res.a, 0x2f, "add a,0x2f left A=0x2f (cp does not change A)");
  assert.equal(res.hl, 0x5000, "mismatch on the first byte -> inc l never ran");
}

test("loc_1ae4: VRAM mismatch tail-jumps 0x1aff; 26 T", () => {
  checkMismatch(runMismatch(loc_1ae4));
});

test("loc_1ae4: a clean full-page pass with C=1 tail-jumps 0x1b70", () => {
  const m = mk({ 0x1aff: "tail", 0x1aca: "tail", 0x1b70: "tail" });
  fillPattern(m, 1);
  m.regs.a = 0x01; m.regs.c = 0x01; m.regs.b = 0x04; m.regs.hl = 0x5000;
  const ret = loc_1ae4(m);
  assert.deepEqual(m.calls, [0x1b70], "all 4 pages pass and C hits 0 -> next stage 0x1b70");
  assert.equal(ret, "TAIL", "the tail-jump's callee result propagates out");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1ae4.js
//   find: m.step(0x1aff, 12);\n      return m.call(0x1aff);
//   repl: m.step(0x1afe, 12);\n      return m.call(0x1afe);
//   expect: FAIL  (jr nz jumps to 0x1afe -- caught by calls == [0x1aff])
//   verified-anchor: count == 1  (the sole jr-nz mismatch target in loc_1ae4.js)
test("loc_1ae4: the contract catches a wrong mismatch target", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.add(0x2f);
    m.step(0x1ae6, 7);
    regs.cp(mem.read8(regs.hl));
    m.step(0x1ae7, 7);
    if (regs.fNZ) {
      m.step(0x1afe, 12); // MUTANT: wrong target
      return m.call(0x1afe);
    }
    // (unreached on the mismatch path)
    m.step(0x1ae9, 7);
    return "unreached";
  };
  assert.throws(() => checkMismatch(runMismatch(mutant)));
});
