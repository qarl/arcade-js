// SPDX-License-Identifier: GPL-3.0-only

// loc_0d06  (ROM 0x0d06-0x0d70) — object state 0 (spawn/init), a rst-28 dispatch target from loc_0cd6.
// Sets a flag at 0x41c2, calls 0x1147 and 0x08f2, then reads a 2-byte record from the table at 0x1dd1
// indexed by direction bits (ix+7)&0x70 >> 3 into (ix+0x16)/(ix+0x18). The direction == 0x0e case takes an
// alternate init (loc_0d58: counts active +0x20/+0x40 neighbours -> 0x422a). Both paths seed the shared
// tail loc_0d39 (motion counters, advance state), branching on (ix+6) bit0 to pick the (ix+5) sign.
export function loc_0d06(m) {
  const { regs, mem } = m;

  mem.write8((regs.ix + 0x17) & 0xffff, 0x00);
  m.step(0x0d0a, 19);
  regs.a = 0x01;
  m.step(0x0d0c, 7);
  mem.write8(0x41c2, regs.a);
  m.step(0x0d0f, 13); // (0x41c2) = 1

  m.push16(0x0d12);
  m.step(0x1147, 17);
  m.call(0x1147);

  regs.e = mem.read8((regs.ix + 0x07) & 0xffff);
  m.step(0x0d15, 19);
  regs.d = 0x01;
  m.step(0x0d17, 7);

  m.push16(0x0d1a);
  m.step(0x08f2, 17);
  m.call(0x08f2);

  regs.a = regs.e;
  m.step(0x0d1b, 4);
  regs.and(0x70);
  m.step(0x0d1d, 7); // A = direction bits
  regs.hl = 0x1dd1;
  m.step(0x0d20, 10); // HL = spawn-record table base
  regs.rrca();
  m.step(0x0d21, 4);
  regs.rrca();
  m.step(0x0d22, 4);
  regs.rrca();
  m.step(0x0d23, 4); // A = index*2
  regs.e = regs.a;
  m.step(0x0d24, 4);
  regs.d = 0x00;
  m.step(0x0d26, 7);
  regs.addHl(regs.de);
  m.step(0x0d27, 11); // HL = table + index*2
  regs.a = mem.read8(regs.hl);
  m.step(0x0d28, 7);
  mem.write8((regs.ix + 0x16) & 0xffff, regs.a); // (ix+0x16) = sprite#
  m.step(0x0d2b, 19);
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0d2c, 6);
  regs.a = mem.read8(regs.hl);
  m.step(0x0d2d, 7);
  mem.write8((regs.ix + 0x18) & 0xffff, regs.a); // (ix+0x18) = 2nd record byte
  m.step(0x0d30, 19);
  regs.a = regs.e;
  m.step(0x0d31, 4);
  regs.cp(0x0e);
  m.step(0x0d33, 7);

  if (regs.fZ) {
    m.step(0x0d58, 12); // jr z,0x0d58 (taken) -- top-direction variant
    mem.write8((regs.ix + 0x0f) & 0xffff, 0x18);
    m.step(0x0d5c, 19);
    regs.xor(regs.a);
    m.step(0x0d5d, 4);
    regs.bit(0, mem.read8((regs.ix + 0x20) & 0xffff));
    m.step(0x0d61, 20);
    if (regs.fNZ) {
      m.step(0x0d63, 7); // jr z,0x0d64 (not taken)
      regs.a = regs.inc8(regs.a);
      m.step(0x0d64, 4);
    } else {
      m.step(0x0d64, 12); // jr z,0x0d64 (taken)
    }
    regs.bit(0, mem.read8((regs.ix + 0x40) & 0xffff));
    m.step(0x0d68, 20);
    if (regs.fNZ) {
      m.step(0x0d6a, 7); // jr z,0x0d6b (not taken)
      regs.a = regs.inc8(regs.a);
      m.step(0x0d6b, 4);
    } else {
      m.step(0x0d6b, 12); // jr z,0x0d6b (taken)
    }
    mem.write8(0x422a, regs.a);
    m.step(0x0d6e, 13); // (0x422a) = active-neighbour count
    m.step(0x0d39, 10); // jp 0x0d39
  } else {
    m.step(0x0d35, 7); // jr z,0x0d58 (not taken)
    mem.write8((regs.ix + 0x0f) & 0xffff, 0x00);
    m.step(0x0d39, 19);
  }

  // loc_0d39: shared tail -- seed motion counters, advance state
  mem.write8((regs.ix + 0x10) & 0xffff, 0x03);
  m.step(0x0d3d, 19);
  mem.write8((regs.ix + 0x11) & 0xffff, 0x0c);
  m.step(0x0d41, 19);
  mem.write8((regs.ix + 0x13) & 0xffff, 0x00);
  m.step(0x0d45, 19);
  regs.incMem8(mem, (regs.ix + 0x02) & 0xffff); // advance state
  m.step(0x0d48, 23);
  regs.bit(0, mem.read8((regs.ix + 0x06) & 0xffff));
  m.step(0x0d4c, 20);

  if (regs.fNZ) {
    m.step(0x0d53, 12); // jr nz,0x0d53 (taken)
    mem.write8((regs.ix + 0x05) & 0xffff, 0xf4);
    m.step(0x0d57, 19); // (ix+5) = -12
    m.ret();
    return;
  }
  m.step(0x0d4e, 7); // jr nz,0x0d53 (not taken)
  mem.write8((regs.ix + 0x05) & 0xffff, 0x0c);
  m.step(0x0d52, 19); // (ix+5) = +12
  m.ret();
}
