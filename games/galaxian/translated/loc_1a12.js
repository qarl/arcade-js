// SPDX-License-Identifier: GPL-3.0-only

// loc_1a12  (ROM 0x1a12-0x1a44) — per-object contribution helper for the loc_198e accumulator. Skips
// (ret) unless bit0 of (ix+0) is set and the object's H/coordinates fall in range: H-0x80 must be >=0 and
// the row band (two 0x34 subtractions -> E=0/1/2) valid, and (0x4202)-L-0x40 must be < 0x80. Builds an
// index E from L&0x60, bit7 of C, and the row band, reads a signed step from the 16-byte table at 0x1a45,
// and adds it into B. Interior label 1a25 inlined; 0x1a45-0x1a54 is that DATA table, not code.
export function loc_1a12(m) {
  const { regs, mem } = m;

  regs.bit(0, mem.read8(regs.ix), (regs.ix >> 8) & 0xff);
  m.step(0x1a16, 20); // bit 0,(ix+0) -- active flag

  if (regs.fZ) {
    m.ret(11); // ret z -- object inactive
    return;
  }
  m.step(0x1a17, 5);

  regs.a = regs.h;
  m.step(0x1a18, 4);

  regs.sub(0x80);
  m.step(0x1a1a, 7);

  if (regs.fC) {
    m.ret(11); // ret c -- H < 0x80, out of range
    return;
  }
  m.step(0x1a1b, 5);

  regs.e = 0x00;
  m.step(0x1a1d, 7); // E = row band

  regs.sub(0x34);
  m.step(0x1a1f, 7);

  if (regs.fC) {
    m.step(0x1a25, 12); // jr c,0x1a25 -- band 0
  } else {
    m.step(0x1a21, 7);
    regs.e = regs.inc8(regs.e);
    m.step(0x1a22, 4); // band 1

    regs.sub(0x34);
    m.step(0x1a24, 7);

    if (regs.fNC) {
      m.ret(11); // ret nc -- past band 1, out of range
      return;
    }
    m.step(0x1a25, 5);
  }

  // loc_1a25:
  regs.a = mem.read8(0x4202);
  m.step(0x1a28, 13); // A = (0x4202) reference X

  regs.sub(regs.l);
  m.step(0x1a29, 4);

  regs.sub(0x40);
  m.step(0x1a2b, 7);

  regs.cp(0x80);
  m.step(0x1a2d, 7);

  if (regs.fNC) {
    m.ret(11); // ret nc -- delta >= 0x80, out of range
    return;
  }
  m.step(0x1a2e, 5);

  regs.and(0x60);
  m.step(0x1a30, 7); // keep bits 5-6 of the delta

  regs.l = regs.a;
  m.step(0x1a31, 4);

  regs.a = regs.c;
  m.step(0x1a32, 4);

  regs.and(0x80);
  m.step(0x1a34, 7); // bit7 of C

  regs.or(regs.l);
  m.step(0x1a35, 4);

  regs.rrca();
  m.step(0x1a36, 4);

  regs.rrca();
  m.step(0x1a37, 4);

  regs.rrca();
  m.step(0x1a38, 4);

  regs.rrca();
  m.step(0x1a39, 4); // >> 4 -> high nibble to low

  regs.or(regs.e);
  m.step(0x1a3a, 4); // fold in the row band

  regs.e = regs.a;
  m.step(0x1a3b, 4);

  regs.d = 0x00;
  m.step(0x1a3d, 7); // DE = table index

  regs.hl = 0x1a45;
  m.step(0x1a40, 10); // signed-step table base

  regs.addHl(regs.de);
  m.step(0x1a41, 11);

  regs.a = mem.read8(regs.hl);
  m.step(0x1a42, 7); // A = table[index] (signed)

  regs.add(regs.b);
  m.step(0x1a43, 4);

  regs.b = regs.a;
  m.step(0x1a44, 4); // accumulate into B

  m.ret();
}
