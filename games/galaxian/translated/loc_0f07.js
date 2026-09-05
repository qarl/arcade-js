// SPDX-License-Identifier: GPL-3.0-only

// loc_0f07  (ROM 0x0f07-0x0f3b) — object AI state handler (entry from the 0x0ce6 state table @0x0cf2).
// Bumps the (ix+3) frame counter through helper 0x1147, and by the pre/post delta either resets the object
// and hands off to 0x08f2 (delta==0), returns (delta>=0x19 or odd), or nudges (ix+5) up/down by the (ix+6)
// direction bit. Folds interior labels loc_0f27 (dir-down arm) and loc_0f2b (reset+handoff arm). ix = the
// object struct in work RAM.
export function loc_0f07(m) {
  const { regs, mem } = m;

  regs.b = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x0f0a, 19); // ld b,(ix+3) -- frame counter

  regs.b = regs.inc8(regs.b);
  m.step(0x0f0b, 4);

  m.push16(0x0f0e);
  m.step(0x1147, 17); // call 0x1147
  m.call(0x1147);

  regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x0f11, 19); // ld a,(ix+3) -- reload (0x1147 may have advanced it)

  mem.write8((regs.ix + 0x03) & 0xffff, regs.b);
  m.step(0x0f14, 19); // (ix+3) <- b

  regs.sub(regs.b);
  m.step(0x0f15, 4); // sub b -- A = reloaded(ix+3) - b

  if (regs.fZ) {
    m.step(0x0f2b, 12); // jr z,0x0f2b -- loc_0f2b (interior): reset + hand off
    mem.write8((regs.ix + 0x00) & 0xffff, 0x00);
    m.step(0x0f2f, 19); // (ix+0) <- 0

    regs.h = 0x41;
    m.step(0x0f31, 7);

    regs.l = mem.read8((regs.ix + 0x07) & 0xffff);
    m.step(0x0f34, 19); // HL = 0x41xx, index from (ix+7)

    regs.d = 0x00;
    m.step(0x0f36, 7);

    mem.write8(regs.hl, 0x01);
    m.step(0x0f38, 10); // (0x41xx) <- 1

    regs.e = regs.l;
    m.step(0x0f39, 4); // DE = 0x00:(ix+7)

    m.step(0x08f2, 10); // jp 0x08f2 (tail)
    return m.call(0x08f2);
  }
  m.step(0x0f17, 7);

  regs.cp(0x19);
  m.step(0x0f19, 7);

  if (regs.fNC) { m.ret(11); return; } // ret nc -- delta >= 0x19
  m.step(0x0f1a, 5);

  regs.and(0x01);
  m.step(0x0f1c, 7);

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- odd delta
  m.step(0x0f1d, 5);

  const ea = (regs.ix + 0x06) & 0xffff;
  regs.bit(0, mem.read8(ea), ea >> 8);
  m.step(0x0f21, 20); // bit 0,(ix+6) -- direction flag

  if (regs.fNZ) {
    m.step(0x0f27, 12); // jr nz,0x0f27 -- loc_0f27 (interior): dir bit set
    regs.decMem8(mem, (regs.ix + 0x05) & 0xffff);
    m.step(0x0f2a, 23); // dec (ix+5)
    m.ret();
    return;
  }
  m.step(0x0f23, 7);

  regs.incMem8(mem, (regs.ix + 0x05) & 0xffff);
  m.step(0x0f26, 23); // inc (ix+5)

  m.ret();
}
