// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_18b2 (ROM 0x18b2-0x18bf):
//   18b2  32 1f 42  ld (0x421f),a
//   18b5  06 04     ld b,0x04
//   18b7  21 04 60  ld hl,0x6004
//   18ba  77        ld (hl),a      ; lfo_freq latches 0x6004-0x6007
//   18bb  23        inc hl
//   18bc  0f        rrca
//   18bd  10 fb     djnz 0x18ba
//   18bf  c9        ret
// Contract: 155 T (13+7+10 + 4x loop + 10); 0x421f=A, the four lfo latches get A rotated right per write.
// With A=0x0f the writes are 0x0f,0x87,0xc3,0xe1 and A ends 0xf0.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_18b2 } from "../loc_18b2.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  return m;
}

function checkSpec(m) {
  assert.equal(m.cycles, 155, "T-state total (13+7+10 + [30+30+30+25] + 10)");
  assert.equal(m.mem.read8(0x421f), 0x0f, "0x421f = A");
  assert.deepEqual(
    [...m.io.soundLfo],
    [0x0f, 0x87, 0xc3, 0xe1],
    "four lfo_freq latches, A rotated right per write",
  );
  assert.equal(m.regs.a, 0xf0, "A ends after the 4th rrca");
  assert.equal(m.pc, 0x1234, "ret popped the caller's return");
}

test("loc_18b2: broadcast A=0x0f to the lfo latches; 155 T", () => {
  const m = mk();
  m.regs.a = 0x0f;
  loc_18b2(m);
  checkSpec(m);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_18b2.js
//   find: regs.rrca();\n    m.step(0x18bd, 4);
//   repl: m.step(0x18bd, 4);   (drop the rotate, keep the timing)
//   expect: FAIL (all four latches get 0x0f, caught by the soundLfo array assert)
test("loc_18b2: the contract catches a dropped rrca", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    mem.write8(0x421f, regs.a); m.step(0x18b5, 13);
    regs.b = 0x04; m.step(0x18b7, 7);
    regs.hl = 0x6004; m.step(0x18ba, 10);
    for (;;) {
      mem.write8(regs.hl, regs.a, 4); m.step(0x18bb, 7);
      regs.hl = (regs.hl + 1) & 0xffff; m.step(0x18bc, 6);
      m.step(0x18bd, 4); // MUTANT: no rrca
      if (regs.djnz() !== 0) { m.step(0x18ba, 13); continue; }
      m.step(0x18bf, 8); break;
    }
    m.ret();
  };
  const m = mk();
  m.regs.a = 0x0f;
  mutant(m);
  assert.throws(() => checkSpec(m));
});
