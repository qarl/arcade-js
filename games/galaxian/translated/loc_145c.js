// SPDX-License-Identifier: GPL-3.0-only

// loc_145c  (ROM 0x145c-0x1471) — activate the free object struct at IX (the slot loc_1446 found): state
// (ix+0)=1, clear phase (ix+2), store C into (ix+6) and source index L into (ix+7); clear the trigger flag
// (hl); DE=0x01:L, then tail-jump loc_08f2 to enqueue that spawn word. Also entered by `call` from loc_1472.
export function loc_145c(m) {
  const { regs, mem } = m;

  mem.write8(regs.hl, 0x00);
  m.step(0x145e, 10); // (hl) <- 0 -- consume the trigger flag

  mem.write8(regs.ix + 0x00, 0x01);
  m.step(0x1462, 19); // (ix+0) <- 1 -- activate the struct

  mem.write8(regs.ix + 0x02, 0x00);
  m.step(0x1466, 19); // (ix+2) <- 0 -- clear phase

  mem.write8(regs.ix + 0x06, regs.c);
  m.step(0x1469, 19); // (ix+6) <- C

  mem.write8(regs.ix + 0x07, regs.l);
  m.step(0x146c, 19); // (ix+7) <- L (source index)

  regs.d = 0x01;
  m.step(0x146e, 7);

  regs.e = regs.l;
  m.step(0x146f, 4); // DE = 0x01:L -- spawn command word

  // jp 0x08f2 -- tail-jump: enqueue DE into the 0x40xx command queue
  m.step(0x08f2, 10);
  return m.call(0x08f2);
}
