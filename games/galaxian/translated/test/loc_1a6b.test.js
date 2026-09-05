// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1a6b (Galaxian cold-boot OBJRAM-clear loop, ROM 0x1A6B-0x1A75):
//   1a6b  77        ld (hl),a       ; clear one OBJRAM byte
//   1a6c  2c        inc l
//   1a6d  c2 6b 1a  jp nz,0x1a6b    ; 256-byte page loop
//   1a70  af        xor a
//   1a71  21 00 60  ld hl,0x6000
//   1a74  06 04     ld b,0x04
// Contract (enter HL=0x5800, A=0): 256*(7+4+10) + 4 + 10 + 7 = 5397 T; zeroes 0x5800-0x58FF;
// ends HL=0x6000, A=0, B=4; tail-falls into the latch-clear loop loc_1a76.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1a6b } from "../loc_1a6b.js";

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

function run(fn, stubs = { 0x1a76: "tail" }) {
  const m = mk(stubs);
  m.regs.hl = 0x5800;
  m.regs.a = 0x00;
  m.mem.objRam.fill(0xaa); // pre-dirty so the clear is observable
  const ret = fn(m);
  let cleared = 0;
  for (let i = 0; i < 0x100; i++) if (m.mem.objRam[i] === 0x00) cleared++;
  return { cycles: m.cycles, calls: m.calls, ret, a: m.regs.a, hl: m.regs.hl, b: m.regs.b, cleared };
}

function checkSpec(res) {
  assert.equal(res.cycles, 5397, "T-state total (256*21 + 4 + 10 + 7)");
  assert.deepEqual(res.calls, [0x1a76], "tail-falls into the latch-clear loop 0x1a76");
  assert.equal(res.ret, "TAIL", "the fall-through callee result propagates out");
  assert.equal(res.cleared, 0x100, "zeroes all 256 bytes of OBJRAM (0x5800-0x58FF)");
  assert.equal(res.hl, 0x6000, "ends HL=0x6000 (points at the latch block)");
  assert.equal(res.a, 0x00, "xor a -> A=0 (latch clear value)");
  assert.equal(res.b, 0x04, "ld b,0x04 -> B=4 (four 0x6000-block latches)");
}

test("loc_1a6b: zeroes OBJRAM, sets up the latch clear, falls into 0x1a76; 5397 T", () => {
  checkSpec(run(loc_1a6b));
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1a6b.js
//   find: regs.hl = 0x6000;
//   repl: regs.hl = 0x6800;
//   expect: FAIL  (wrong latch-block pointer -- caught by hl == 0x6000)
//   verified-anchor: count == 1  (the sole "regs.hl = 0x6000" in loc_1a6b.js)
test("loc_1a6b: the contract catches a wrong latch-block pointer", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    for (;;) {
      mem.write8(regs.hl, regs.a);
      m.step(0x1a6c, 7);
      regs.l = regs.inc8(regs.l);
      m.step(0x1a6d, 4);
      if (regs.fNZ) { m.step(0x1a6b, 10); continue; }
      m.step(0x1a70, 10);
      break;
    }
    regs.xor(regs.a);
    m.step(0x1a71, 4);
    regs.hl = 0x6800; // MUTANT: wrong latch-block pointer
    m.step(0x1a74, 10);
    regs.b = 0x04;
    m.step(0x1a76, 7);
    return m.call(0x1a76);
  };
  assert.throws(() => checkSpec(run(mutant)));
});
