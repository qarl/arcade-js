// SPDX-License-Identifier: GPL-3.0-only

// loc_123f  (ROM 0x123f-0x125d) — per-object hit test on the entry at IX vs the (0x4209) reference
// position (X=0x4209, Y=0x420a). bit0 of (ix+0)=active; a 6-wide/12-tall box around X=(ix+3)/Y=(ix+4).
// A hit sets (0x420b)=1 and falls through into loc_125e (deactivate). Called from 0x1236.
export function loc_123f(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8((regs.ix + 0x00) & 0xffff), ((regs.ix + 0x00) >> 8) & 0xff);
  m.step(0x1243, 20); // bit 0,(ix+0) -- active flag
  if (regs.fZ) { m.ret(11); return; } // ret z -- inactive entry
  m.step(0x1244, 5);

  regs.hl = mem.read16(0x4209);
  m.step(0x1247, 16); // HL = reference X(0x4209)/Y(0x420a)

  regs.a = mem.read8((regs.ix + 0x03) & 0xffff);
  m.step(0x124a, 19); // A = entry X
  regs.sub(regs.l);
  m.step(0x124b, 4);
  regs.add(0x02);
  m.step(0x124d, 7);
  regs.cp(0x06);
  m.step(0x124f, 7); // X within the 6-wide band?
  if (regs.fNC) { m.ret(11); return; } // ret nc -- outside X band
  m.step(0x1250, 5);

  regs.a = mem.read8((regs.ix + 0x04) & 0xffff);
  m.step(0x1253, 19); // A = entry Y
  regs.sub(regs.h);
  m.step(0x1254, 4);
  regs.add(0x05);
  m.step(0x1256, 7);
  regs.cp(0x0c);
  m.step(0x1258, 7); // Y within the 12-tall band?
  if (regs.fNC) { m.ret(11); return; } // ret nc -- outside Y band
  m.step(0x1259, 5);

  regs.a = 0x01;
  m.step(0x125b, 7);
  mem.write8(0x420b, regs.a);
  m.step(0x125e, 13); // (0x420b) = 1 -- hit flag

  // fall-through into loc_125e (deactivate the hit entry) -- separate routine, delegate
  return m.call(0x125e);
}
