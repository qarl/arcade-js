// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a7d (Galaxian cold-boot hardware wipe, ROM 0x1a7d-0x1a86):
//   1a7d  77        ld (hl),a      ; store A into 0x6004..0x6007 (sound LFO-freq latches)
//   1a7e  23        inc hl
//   1a7f  10 fc     djnz 0x1a7d
//   1a81  af        xor a          ; A=0
//   1a82  06 08     ld b,0x08
//   1a84  21 00 68  ld hl,0x6800
//   -> fall through to loc_1a87
// Contract (entry HL=0x6004, B=4, A=1): 120 T (loop 4*13 + 3*13 + 8 = 99, then 4+7+10=21),
// soundLfo[0..3]=1, exit HL=0x6800 / B=8 / A=0, tail-calls loc_1a87.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a7d } from "../loc_1a7d.js";

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

function run(fn, stubs = { 0x1a87: "tail" }) {
  const m = mk(stubs);
  m.regs.hl = 0x6004; m.regs.b = 0x04; m.regs.a = 0x01;
  const ret = fn(m);
  return {
    cycles: m.cycles, calls: m.calls, ret,
    hl: m.regs.hl, b: m.regs.b, a: m.regs.a,
    lfo: Array.from(m.io.soundLfo),
  };
}

function checkSpec(res) {
  assert.equal(res.cycles, 120, "T-state total (loop 99 + xor 4 + ld b 7 + ld hl 10)");
  assert.deepEqual(res.calls, [0x1a87], "tail-calls loc_1a87");
  assert.equal(res.ret, "TAIL", "the tail-call result propagates out");
  assert.deepEqual(res.lfo, [1, 1, 1, 1], "wrote A(=1) to the four 0x6004-0x6007 LFO-freq latches");
  assert.equal(res.hl, 0x6800, "exit HL=0x6800 (reloaded for the next clear)");
  assert.equal(res.b, 0x08, "exit B=8");
  assert.equal(res.a, 0x00, "exit A=0 (xor a)");
}

test("loc_1a7d: fills LFO latches, reloads for the 0x6800 clear, tail-calls loc_1a87; 120 T", () => {
  checkSpec(run(loc_1a7d));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a7d.js
//   find: mem.write8(regs.hl, regs.a, 4);
//   repl: mem.write8(regs.hl, 0, 4);
//   expect: FAIL  (writes 0 not A -> soundLfo == [0,0,0,0], caught by the lfo assertion)
//   verified-anchor: count == 1  (the sole store in loc_1a7d.js)
test("loc_1a7d: the contract catches a wrong store value", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, 0, 4); // MUTANT: stores 0 instead of A
      m.step(0x1a7e, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1a7f, 6);
      if (m.regs.djnz() !== 0) { m.step(0x1a7d, 13); continue; }
      m.step(0x1a81, 8);
      break;
    }
    regs.xor(regs.a);
    m.step(0x1a82, 4);
    regs.b = 0x08;
    m.step(0x1a84, 7);
    regs.hl = 0x6800;
    m.step(0x1a87, 10);
    return m.call(0x1a87);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
