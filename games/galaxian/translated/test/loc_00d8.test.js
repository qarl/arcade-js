// SPDX-License-Identifier: GPL-3.0-only
// Drafter test for loc_00d8 (Galaxian VBLANK-NMI epilogue, ROM 0x00D8-0x00E5):
//   pop iy/ix/hl/de/bc (restore the pairs loc_0066 saved), ld a,1; ld (0x7001),a (re-arm irq_enable),
//   pop af (restore caller A/F over the ld a,1), ret (pop the interrupted PC).
// Contract: irq_enable latched back to 1; six pairs restored from the stack (top-down iy..af); SP advanced
//   by 14 (7 pops); pc = the interrupted return address; 98 T (14+14+10+10+10+7+13+10+10).

import test from "node:test";
import assert from "node:assert/strict";
import { Machine } from "../../machine.js";
import { loc_00d8 } from "../loc_00d8.js";

function mk() {
  const m = new Machine(new Uint8Array(0x4000), new Map());
  m.nextNmi = Infinity; m.nextBoundary = Infinity; m.maxCycles = Infinity; m.maxFrames = Infinity;
  return m;
}

// Seat the stack exactly as loc_0066 left it: pushes were af,bc,de,hl,ix,iy (so iy is on top), then a
// caller/return frame pushed 0x00d8, whose handler already popped it -- leaving the return PC under af.
function seatStack(m) {
  m.regs.sp = 0x43f0;
  m.mem.write16(0x43f0, 0x1234); // iy   (top)
  m.mem.write16(0x43f2, 0x5678); // ix
  m.mem.write16(0x43f4, 0x9abc); // hl
  m.mem.write16(0x43f6, 0xdef0); // de
  m.mem.write16(0x43f8, 0x0f1e); // bc
  m.mem.write16(0x43fa, 0x2d3c); // af
  m.mem.write16(0x43fc, 0x2000); // interrupted main-loop PC (ret target)
}

test("loc_00d8: restores regs, re-arms irq_enable, rets to the interrupted PC; 98 T", () => {
  const m = mk();
  m.io.irqEnable = 0; // loc_0066 acked the NMI at 0x0072; the epilogue re-arms it
  seatStack(m);
  loc_00d8(m);

  assert.equal(m.io.irqEnable, 1, "ld a,1; ld (0x7001),a re-armed irq_enable (NMI back ON)");
  assert.equal(m.regs.iy, 0x1234, "pop iy");
  assert.equal(m.regs.ix, 0x5678, "pop ix");
  assert.equal(m.regs.hl, 0x9abc, "pop hl");
  assert.equal(m.regs.de, 0xdef0, "pop de");
  assert.equal(m.regs.bc, 0x0f1e, "pop bc");
  assert.equal(m.regs.af, 0x2d3c, "pop af restores the caller A/F over the ld a,1");
  assert.equal(m.regs.sp, 0x43fe, "SP advanced by 14 (7 pops: 6 pairs + the ret)");
  assert.equal(m.pc, 0x2000, "ret popped the interrupted main-loop PC");
  assert.equal(m.cycles, 98, "T total 14+14+10+10+10+7+13+10+10");
});

// MUTATION-PATCH  file: games/galaxian/translated/loc_00d8.js
//   find: regs.a = 0x01;
//   repl: regs.a = 0x00;
//   expect: FAIL  (irq_enable would be re-cleared to 0, so the NMI never fires again)
//   verified-anchor: count == 1  (the sole "regs.a = 0x01" in loc_00d8.js)
test("loc_00d8: the contract catches a failure to re-arm irq_enable", () => {
  const m = mk();
  m.io.irqEnable = 0;
  seatStack(m);
  const mutant = (mm) => {
    const { regs, mem } = mm;
    regs.iy = mm.pop16(); mm.step(0x00da, 14);
    regs.ix = mm.pop16(); mm.step(0x00dc, 14);
    regs.hl = mm.pop16(); mm.step(0x00dd, 10);
    regs.de = mm.pop16(); mm.step(0x00de, 10);
    regs.bc = mm.pop16(); mm.step(0x00df, 10);
    regs.a = 0x00; mm.step(0x00e1, 7); // MUTANT: writes 0 instead of 1
    mem.write8(0x7001, regs.a, 10); mm.step(0x00e4, 13);
    regs.af = mm.pop16(); mm.step(0x00e5, 10);
    mm.ret();
  };
  mutant(m);
  assert.equal(m.io.irqEnable, 0, "mutant left irq_enable cleared -> the NMI would never re-fire");
});
