// SPDX-License-Identifier: GPL-3.0-only

// loc_1472  (ROM 0x1472-0x148d) — spawn a primary object into struct 0x42d0 (loc_145c) with C=2, then walk
// B=3 trigger flags downward from HL-0x0F: for each with bit0 set, propagate via loc_148e (which spawns a
// secondary slot at IY, base 0x42f0, C=2 remaining). Interior loop top loc_1485 is inlined (djnz).
export function loc_1472(m) {
  const { regs, mem } = m;

  regs.ix = 0x42d0;
  m.step(0x1476, 14); // ld ix,0x42d0 -- primary object struct

  m.push16(0x1479);
  m.step(0x145c, 17); // call 0x145c -- spawn into (ix)
  m.call(0x145c);

  regs.a = regs.l;
  m.step(0x147a, 4);

  regs.sub(0x0f);
  m.step(0x147c, 7);

  regs.l = regs.a;
  m.step(0x147d, 4); // HL -= 0x0F -- back up to the trigger-flag block

  regs.iy = 0x42f0;
  m.step(0x1481, 14); // ld iy,0x42f0 -- secondary slot base

  regs.b = 0x03;
  m.step(0x1483, 7);

  regs.c = 0x02;
  m.step(0x1485, 7); // C=2 secondary-slot budget

  for (;;) {
    // loc_1485 (interior loop top)
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x1487, 12); // bit 0,(hl) -- Z when this trigger is clear

    if (regs.fNZ) {
      m.push16(0x148a);
      m.step(0x148e, 17); // call nz,0x148e (taken) -- propagate to a secondary slot
      m.call(0x148e);
    } else {
      m.step(0x148a, 10); // call nz,0x148e (not taken)
    }

    regs.l = regs.dec8(regs.l);
    m.step(0x148b, 4);

    if (regs.djnz() !== 0) {
      m.step(0x1485, 13); // djnz 0x1485 (taken)
      continue;
    }
    m.step(0x148d, 8); // djnz 0x1485 (not taken)
    break;
  }

  m.ret();
}
