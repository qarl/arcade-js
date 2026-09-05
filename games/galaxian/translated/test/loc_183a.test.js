// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_183a (ROM 0x183a-0x184e), entered with A = 0x41df selector:
//   183a  fe 16     cp 0x16
//   183c  c0        ret nz          ; selector != 0x16 -> return
//   183d  af        xor a           ; A = 0
//   183e  32 cf 41  ld (0x41cf),a   ; =0
//   1841  3c        inc a           ; A = 1
//   1842  32 cd 41  ld (0x41cd),a   ; =1
//   1845  32 d6 41  ld (0x41d6),a   ; =1
//   1848  21 df 1e  ld hl,0x1edf
//   184b  22 d3 41  ld (0x41d3),hl  ; sequence pointer
//   184e  c9        ret
// Contract A (selector != 0x16): 18 T (7+11), no arm. Contract B (== 0x16): 95 T, arms 0x1edf.

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_183a } from "../loc_183a.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.mem.write8(0x4400, 0x34); m.mem.write8(0x4401, 0x12); // caller return = 0x1234
  return m;
}

test("loc_183a: selector != 0x16 -> ret nz; 18 T, no arm", () => {
  const m = mk();
  m.regs.a = 0x06;
  loc_183a(m);
  assert.equal(m.cycles, 18, "7 + 11");
  assert.equal(m.pc, 0x1234, "ret nz returned to the caller");
  assert.equal(m.mem.read16(0x41d3), 0, "no sequence armed");
});

test("loc_183a: selector == 0x16 -> arm 0x1edf sequence; 95 T", () => {
  const m = mk();
  m.regs.a = 0x16;
  loc_183a(m);
  assert.equal(m.cycles, 95, "full arm path");
  assert.equal(m.mem.read8(0x41cf), 0, "0x41cf = 0");
  assert.equal(m.mem.read8(0x41cd), 1, "0x41cd = 1");
  assert.equal(m.mem.read8(0x41d6), 1, "0x41d6 = 1");
  assert.equal(m.mem.read16(0x41d3), 0x1edf, "0x41d3 = sequence pointer 0x1edf");
  assert.equal(m.pc, 0x1234, "ret to the caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_183a.js
//   find: regs.hl = 0x1edf;
//   repl: regs.hl = 0x1ede;
//   expect: FAIL ((0x41d3) becomes 0x1ede, caught by the 0x1edf assert)
test("loc_183a: the contract catches a wrong sequence pointer", () => {
  const mutant = (m) => {
    const { regs, mem } = m;
    regs.cp(0x16); m.step(0x183c, 7);
    if (regs.fNZ) { m.ret(11); return; }
    m.step(0x183d, 5);
    regs.xor(regs.a); m.step(0x183e, 4);
    mem.write8(0x41cf, regs.a); m.step(0x1841, 13);
    regs.a = regs.inc8(regs.a); m.step(0x1842, 4);
    mem.write8(0x41cd, regs.a); m.step(0x1845, 13);
    mem.write8(0x41d6, regs.a); m.step(0x1848, 13);
    regs.hl = 0x1ede; m.step(0x184b, 10); // MUTANT
    mem.write16(0x41d3, regs.hl); m.step(0x184e, 16);
    return m.ret();
  };
  const m = mk();
  m.regs.a = 0x16;
  mutant(m);
  assert.throws(() => assert.equal(m.mem.read16(0x41d3), 0x1edf));
});
