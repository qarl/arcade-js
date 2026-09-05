// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_1747 (ROM 0x1747-0x175c):
//   1747  3a d1 41  ld a,(0x41d1)
//   174a  3d        dec a
//   174b  c0        ret nz          ; timer not yet 0 -> return
//   174c  32 d1 41  ld (0x41d1),a   ; A=0 here
//   174f  3c        inc a
//   1750  32 d2 41  ld (0x41d2),a   ; =1
//   1753  32 d6 41  ld (0x41d6),a   ; =1
//   1756  21 68 1e  ld hl,0x1e68
//   1759  22 d3 41  ld (0x41d3),hl  ; data pointer
//   175c  c9        ret
// Contract A (timer live): 28 T (13+4+11), 0x41d1 unchanged, ret.
// Contract B (timer expired): 101 T (13+4+5+13+4+13+13+10+16+10); 0x41d1=0, 0x41d2=0x41d6=1, (0x41d3)=0x1e68.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_1747 } from "../loc_1747.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  return m;
}

function checkExpired(m) {
  assert.equal(m.cycles, 101, "T-state total, expired path");
  assert.equal(m.mem.read8(0x41d1), 0, "0x41d1 cleared");
  assert.equal(m.mem.read8(0x41d2), 1, "0x41d2 = 1");
  assert.equal(m.mem.read8(0x41d6), 1, "0x41d6 = 1");
  assert.equal(m.mem.read16(0x41d3), 0x1e68, "0x41d3 = data pointer 0x1e68");
  assert.equal(m.pc, 0x1234, "ret popped the caller's return");
}

test("loc_1747: timer live -> ret nz; 28 T, no writes", () => {
  const m = mk();
  m.mem.write8(0x41d1, 5); // dec -> 4, nonzero
  loc_1747(m);
  assert.equal(m.cycles, 28, "13 + 4 + 11");
  assert.equal(m.mem.read8(0x41d1), 5, "0x41d1 untouched on the live path");
  assert.equal(m.pc, 0x1234, "ret nz returned to the caller");
});

test("loc_1747: timer expired -> re-arm sequencer; 101 T", () => {
  const m = mk();
  m.mem.write8(0x41d1, 1); // dec -> 0
  loc_1747(m);
  checkExpired(m);
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_1747.js
//   find: regs.hl = 0x1e68;
//   repl: regs.hl = 0x1e60;
//   expect: FAIL ((0x41d3) becomes 0x1e60, caught by the 0x1e68 assert)
test("loc_1747: the contract catches a wrong data pointer", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.a = mem.read8(0x41d1); m.step(0x174a, 13);
    regs.a = regs.dec8(regs.a); m.step(0x174b, 4);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x174c, 5);
    mem.write8(0x41d1, regs.a); m.step(0x174f, 13);
    regs.a = regs.inc8(regs.a); m.step(0x1750, 4);
    mem.write8(0x41d2, regs.a); m.step(0x1753, 13);
    mem.write8(0x41d6, regs.a); m.step(0x1756, 13);
    regs.hl = 0x1e60; m.step(0x1759, 10); // MUTANT
    mem.write16(0x41d3, regs.hl); m.step(0x175c, 16);
    m.ret();
  };
  const m = mk();
  m.mem.write8(0x41d1, 1);
  mutant(m);
  assert.throws(() => checkExpired(m));
});
