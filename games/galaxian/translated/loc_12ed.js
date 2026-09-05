// SPDX-License-Identifier: GPL-3.0-only

// loc_12ed  (ROM 0x12ed-0x1326) — consume the event flag (0x4204) set by loc_12b6; called per-frame from
// 0x068e. If (0x4204) bit0 clear -> ret. Otherwise clears it, resets state: (0x4200)=0x0100, (0x4205)=0x040a,
// enqueues sound command 0x0205 (loc_08f2), decrements the (0x421a) countdown (floored at 0), cycles the
// (0x421d) counter within [0,5], and if (0x4006) bit0 set raises sound_w reg3 (0x6803)=1. loc_130e/loc_131c
// are jr interior labels (inlined).
export function loc_12ed(m) {
  const { regs, mem } = m;

  regs.hl = 0x4204;
  m.step(0x12f0, 10);

  regs.bit(0, mem.read8(regs.hl));
  m.step(0x12f2, 12);

  if (regs.fZ) { m.ret(11); return; } // ret z -- no event pending
  m.step(0x12f3, 5);

  mem.write8(regs.hl, 0x00);
  m.step(0x12f5, 10); // clear event flag (0x4204)

  regs.hl = 0x0100;
  m.step(0x12f8, 10);

  mem.write16(0x4200, regs.hl);
  m.step(0x12fb, 16); // (0x4200) <- 0x0100

  regs.hl = 0x040a;
  m.step(0x12fe, 10);

  mem.write16(0x4205, regs.hl);
  m.step(0x1301, 16); // (0x4205) <- 0x040a

  regs.de = 0x0205;
  m.step(0x1304, 10);

  m.push16(0x1307);
  m.step(0x08f2, 17);
  m.call(0x08f2); // enqueue sound command DE=0x0205

  regs.a = mem.read8(0x421a);
  m.step(0x130a, 13);

  regs.and(regs.a);
  m.step(0x130b, 4);

  if (regs.fZ) {
    m.step(0x130e, 12); // jr z,0x130e -- already at 0, don't underflow
  } else {
    m.step(0x130d, 7);
    regs.a = regs.dec8(regs.a);
    m.step(0x130e, 4);
  }

  // loc_130e (interior):
  mem.write8(0x421a, regs.a);
  m.step(0x1311, 13); // (0x421a) countdown floored at 0

  regs.hl = 0x421d;
  m.step(0x1314, 10);

  regs.decMem8(mem, regs.hl);
  m.step(0x1315, 11); // dec (0x421d)

  regs.a = mem.read8(regs.hl);
  m.step(0x1316, 7);

  regs.cp(0x06);
  m.step(0x1318, 7);

  if (regs.fC) {
    m.step(0x131c, 12); // jr c,0x131c -- in [0,5]
  } else {
    m.step(0x131a, 7);
    mem.write8(regs.hl, 0x05);
    m.step(0x131c, 10); // clamp (0x421d) to 5 (wrap from 0)
  }

  // loc_131c (interior):
  regs.a = mem.read8(0x4006);
  m.step(0x131f, 13);

  regs.rrca();
  m.step(0x1320, 4); // carry = (0x4006) bit0

  if (regs.fNC) { m.ret(11); return; } // ret nc -- bit0 clear, no sound
  m.step(0x1321, 5);

  regs.a = 0x01;
  m.step(0x1323, 7);

  mem.write8(0x6803, regs.a, 10);
  m.step(0x1326, 13); // sound_w reg3 (0x6803) <- 1

  m.ret();
}
