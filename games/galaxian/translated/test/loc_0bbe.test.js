// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_0bbe (ROM 0x0bbe-0x0c1f): build 8 sprite-staging rows via loc_0c20.
//   (a) (0x4018) bit0 clear -> normal arm C=7 then inc->8; 3+5 rows. 717 T, 8x loc_0c20.
//   (b) (0x4018) bit0 set   -> flipped arm (loc_0bf2) C=9 then dec->8; 3+5 rows. 722 T, 8x loc_0c20.
// Both arms advance IX by 0x20 and IY by 4 per row (loc_0c20 stubbed as a pop stub).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_0bbe } from "../loc_0bbe.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  m.regs.sp = 0x4400;
  m.routines.set(0x0c20, (mm) => { mm.pop16(); }); // real call -> pop stub balances the stack
  m.calls = [];
  const oc = m.call.bind(m);
  m.call = (a, ...r) => { m.calls.push(a); return oc(a, ...r); };
  m.push16(0xbeef); // return address for the routine's own ret
  return m;
}

test("loc_0bbe: (0x4018) bit0 clear -> normal arm, 8 rows; 717 T", () => {
  const m = mk();
  m.mem.write8(0x4018, 0x00);
  loc_0bbe(m);
  assert.equal(m.cycles, 717, "head 66 + loop1 235 + (7+4) + loop2 395 + ret 10");
  assert.deepEqual(m.calls, Array(8).fill(0x0c20), "3 + 5 rows");
  assert.equal(m.regs.ix, 0x43b0, "IX = 0x42b0 + 8*0x20");
  assert.equal(m.regs.iy, 0x4080, "IY = 0x4060 + 8*4");
  assert.equal(m.regs.c, 0x08, "C = 7 then inc -> 8");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

test("loc_0bbe: (0x4018) bit0 set -> flipped arm (loc_0bf2), 8 rows; 722 T", () => {
  const m = mk();
  m.mem.write8(0x4018, 0x01);
  loc_0bbe(m);
  assert.equal(m.cycles, 722, "flipped head 71 + loop3 235 + (7+4) + loop4 395 + ret 10");
  assert.deepEqual(m.calls, Array(8).fill(0x0c20), "3 + 5 rows");
  assert.equal(m.regs.ix, 0x43b0, "IX = 0x42b0 + 8*0x20");
  assert.equal(m.regs.iy, 0x4080, "IY = 0x4060 + 8*4");
  assert.equal(m.regs.c, 0x08, "C = 9 then dec -> 8");
  assert.equal(m.pc, 0xbeef, "ret to caller");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_0bbe.js
//   find: regs.c = regs.inc8(regs.c);   (normal-arm mid-loop color bump at 0x0be1)
//   repl: regs.c = regs.dec8(regs.c);
//   expect: FAIL (C ends at 6 not 8 -> the normal-arm C-contract catches it)
test("loc_0bbe: contract catches a wrong mid-loop C bump", () => {
  const m = mk();
  const { regs, mem } = m;
  mem.write8(0x4018, 0x00);
  const body = (mm, top, ret) => {
    for (;;) {
      mm.push16(ret); mm.step(0x0c20, 17); mm.call(0x0c20);
      regs.de = 0x0020; mm.step(top + 6, 10); regs.addIx(regs.de); mm.step(top + 8, 15);
      regs.de = 0x0004; mm.step(top + 10, 10); regs.addIy(regs.de); mm.step(top + 13, 15);
      if (regs.djnz() !== 0) { mm.step(top, 13); continue; }
      mm.step(top + 15, 8); break;
    }
  };
  regs.a = mem.read8(0x4018); m.step(0x0bc1, 13);
  regs.rrca(); m.step(0x0bc2, 4);
  m.step(0x0bc4, 7); // jr c not taken
  regs.ix = 0x42b0; m.step(0x0bc8, 14);
  regs.iy = 0x4060; m.step(0x0bcc, 14);
  regs.b = 0x03; m.step(0x0bce, 7);
  regs.c = 0x07; m.step(0x0bd0, 7);
  body(m, 0x0bd0, 0x0bd3);
  regs.b = 0x05; m.step(0x0be1, 7);
  regs.c = regs.dec8(regs.c); m.step(0x0be2, 4); // MUTANT: dec instead of inc
  body(m, 0x0be2, 0x0be5);
  m.ret();
  assert.throws(() => assert.equal(m.regs.c, 0x08));
});
