// SPDX-License-Identifier: GPL-3.0-only

// loc_0f3c  (ROM 0x0f3c-0x0f65) — object AI state handler (entry from the 0x0ce6 state table @0x0cf4).
// Fixed-point homing on target (0x4202): DE = signed (2*(pos-target)) built via neg/rla/sbc a,a/rl, then
// the 16-bit position:subpixel HL=(ix+4):(ix+9) is decremented by DE and stored back. Ticks the (ix+0x10)
// state timer; on expiry advances the state field (ix+2). ix = the object struct in work RAM.
export function loc_0f3c(m) {
  const { regs, mem } = m;

  regs.incMem8(mem, (regs.ix + 0x03) & 0xffff);
  m.step(0x0f3f, 23); // inc (ix+3) -- frame counter

  regs.a = mem.read8(0x4202);
  m.step(0x0f42, 13); // A = target coord

  regs.sub(mem.read8((regs.ix + 0x04) & 0xffff));
  m.step(0x0f45, 19); // A = target - (ix+4)

  regs.neg();
  m.step(0x0f47, 8); // A = (ix+4) - target

  regs.rla();
  m.step(0x0f48, 4); // C <- sign, A <<= 1

  regs.e = regs.a;
  m.step(0x0f49, 4);

  regs.sbc(regs.a);
  m.step(0x0f4a, 4); // sbc a,a -- A = sign extension (0x00 / 0xFF)

  regs.d = regs.a;
  m.step(0x0f4b, 4);

  regs.e = regs.rl(regs.e);
  m.step(0x0f4d, 8); // rl e

  regs.d = regs.rl(regs.d);
  m.step(0x0f4f, 8); // rl d -- DE = signed step

  regs.h = mem.read8((regs.ix + 0x04) & 0xffff);
  m.step(0x0f52, 19); // H = (ix+4)

  regs.l = mem.read8((regs.ix + 0x09) & 0xffff);
  m.step(0x0f55, 19); // L = (ix+9) -- HL = pos:subpixel

  regs.and(regs.a);
  m.step(0x0f56, 4); // clear carry for the sbc

  regs.sbcHl(regs.de);
  m.step(0x0f58, 15); // HL -= DE

  mem.write8((regs.ix + 0x04) & 0xffff, regs.h);
  m.step(0x0f5b, 19); // (ix+4) <- H

  mem.write8((regs.ix + 0x09) & 0xffff, regs.l);
  m.step(0x0f5e, 19); // (ix+9) <- L

  regs.decMem8(mem, (regs.ix + 0x10) & 0xffff);
  m.step(0x0f61, 23); // dec (ix+0x10) -- state timer

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- timer still running
  m.step(0x0f62, 5);

  regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);
  m.step(0x0f65, 23); // inc (ix+2) -- advance state

  m.ret();
}
