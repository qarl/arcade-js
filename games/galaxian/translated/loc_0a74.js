// SPDX-License-Identifier: GPL-3.0-only

// loc_0a74  (ROM 0x0a74-0x0b0a) — called from 0x0667. Per-object motion/sprite update over B=7 entries.
// IX walks object structs at 0x4260 (stride +10 per entry: +5 twice), IY walks sprite shadow at 0x4081
// (stride +4). Entry: (0x425f) bit0 clear -> bump (ix+1) by 2 and skip the first struct (+5). Per entry, if
// (ix+0) bit0 set: advance sub-position (ix+1)+=2 (carry -> deactivate), integrate (ix+2/3) += sign-extended
// (ix+4)<<1, deactivate if hi byte out of [0xF0,0x10) window (h+0x10 vs 0x20). Deactivate = clear
// (ix+0/1/3). Then write sprite Y (iy+2) and code/flag (iy+0) from (ix+1)/(ix+3), direction from (0x4018)
// bit0, with a +/-1 code nudge when B<5. Advance (ix+1) by 2 on the second struct too, then next entry.
export function loc_0a74(m) {
  const { regs, mem } = m;

  regs.ix = 0x4260;
  m.step(0x0a78, 14);
  regs.a = mem.read8(0x425f);
  m.step(0x0a7b, 13);
  regs.rrca();
  m.step(0x0a7c, 4);
  if (regs.fC) {
    m.step(0x0a89, 12); // jr c,0x0a89
  } else {
    m.step(0x0a7e, 7);
    regs.incMem8(mem, regs.ix + 0x01);
    m.step(0x0a81, 23);
    regs.incMem8(mem, regs.ix + 0x01);
    m.step(0x0a84, 23); // (ix+1) += 2
    regs.de = 0x0005;
    m.step(0x0a87, 10);
    regs.addIx(regs.de);
    m.step(0x0a89, 15); // skip first struct
  }

  // loc_0a89:
  regs.iy = 0x4081;
  m.step(0x0a8d, 14);
  regs.b = 0x07;
  m.step(0x0a8f, 7);

  for (;;) {
    // loc_0a8f loop top
    regs.bit(0, mem.read8(regs.ix + 0x00), (regs.ix + 0x00) >> 8);
    m.step(0x0a93, 20); // (ix+0) bit0 = active
    let doClear;
    if (regs.fZ) {
      m.step(0x0abc, 12); // jr z,0x0abc -- inactive
      doClear = true;
    } else {
      m.step(0x0a95, 7);
      regs.a = mem.read8(regs.ix + 0x01);
      m.step(0x0a98, 19);
      regs.add(0x02);
      m.step(0x0a9a, 7);
      mem.write8(regs.ix + 0x01, regs.a);
      m.step(0x0a9d, 19); // (ix+1) += 2
      regs.add(0x04);
      m.step(0x0a9f, 7);
      if (regs.fC) {
        m.step(0x0abc, 12); // jr c,0x0abc -- sub-position overflow
        doClear = true;
      } else {
        m.step(0x0aa1, 7);
        regs.l = mem.read8(regs.ix + 0x02);
        m.step(0x0aa4, 19);
        regs.h = mem.read8(regs.ix + 0x03);
        m.step(0x0aa7, 19);
        regs.e = mem.read8(regs.ix + 0x04);
        m.step(0x0aaa, 19);
        regs.e = regs.rl(regs.e);
        m.step(0x0aac, 8); // carry = (ix+4) bit7
        regs.sbc(regs.a);
        m.step(0x0aad, 4); // A = sign-extension (0x00/0xFF)
        regs.d = regs.a;
        m.step(0x0aae, 4);
        regs.addHl(regs.de);
        m.step(0x0aaf, 11); // (ix+2/3) += signed delta
        mem.write8(regs.ix + 0x02, regs.l);
        m.step(0x0ab2, 19);
        mem.write8(regs.ix + 0x03, regs.h);
        m.step(0x0ab5, 19);
        regs.a = regs.h;
        m.step(0x0ab6, 4);
        regs.add(0x10);
        m.step(0x0ab8, 7);
        regs.cp(0x20);
        m.step(0x0aba, 7); // hi byte in [0xF0,0x10) window?
        if (regs.fNC) {
          m.step(0x0ac6, 12); // jr nc,0x0ac6 -- in range, keep
          doClear = false;
        } else {
          m.step(0x0abc, 7); // fall into 0x0abc -- out of range
          doClear = true;
        }
      }
    }
    if (doClear) {
      // loc_0abc:
      regs.xor(regs.a);
      m.step(0x0abd, 4);
      mem.write8(regs.ix + 0x00, regs.a);
      m.step(0x0ac0, 19); // (ix+0) <- 0 (deactivate)
      mem.write8(regs.ix + 0x01, regs.a);
      m.step(0x0ac3, 19);
      mem.write8(regs.ix + 0x03, regs.a);
      m.step(0x0ac6, 19);
    }

    // loc_0ac6:
    regs.a = mem.read8(0x4018);
    m.step(0x0ac9, 13);
    regs.rrca();
    m.step(0x0aca, 4); // carry = (0x4018) bit0 = direction
    if (regs.fC) {
      m.step(0x0af5, 12); // jr c,0x0af5
      // loc_0af5:
      regs.a = mem.read8(regs.ix + 0x01);
      m.step(0x0af8, 19);
      regs.sub(0x04);
      m.step(0x0afa, 7);
      mem.write8(regs.iy + 0x02, regs.a);
      m.step(0x0afd, 19); // sprite Y (iy+2) <- (ix+1)-4
      regs.a = mem.read8(regs.ix + 0x03);
      m.step(0x0b00, 19);
      regs.cpl();
      m.step(0x0b01, 4);
      regs.c = regs.a;
      m.step(0x0b02, 4);
      regs.a = regs.b;
      m.step(0x0b03, 4);
      regs.cp(0x05);
      m.step(0x0b05, 7);
      if (regs.fC) {
        m.step(0x0adf, 12); // jr c,0x0adf
      } else {
        m.step(0x0b07, 7);
        regs.c = regs.dec8(regs.c);
        m.step(0x0b08, 4); // B>=5: C--
        m.step(0x0adf, 10); // jp 0x0adf
      }
    } else {
      m.step(0x0acc, 7);
      regs.a = mem.read8(regs.ix + 0x01);
      m.step(0x0acf, 19);
      regs.cpl();
      m.step(0x0ad0, 4);
      regs.a = regs.dec8(regs.a);
      m.step(0x0ad1, 4);
      mem.write8(regs.iy + 0x02, regs.a);
      m.step(0x0ad4, 19); // sprite Y (iy+2) <- ~(ix+1)-1
      regs.a = mem.read8(regs.ix + 0x03);
      m.step(0x0ad7, 19);
      regs.cpl();
      m.step(0x0ad8, 4);
      regs.c = regs.a;
      m.step(0x0ad9, 4);
      regs.a = regs.b;
      m.step(0x0ada, 4);
      regs.cp(0x05);
      m.step(0x0adc, 7);
      if (regs.fC) {
        m.step(0x0adf, 12); // jr c,0x0adf
      } else {
        m.step(0x0ade, 7);
        regs.c = regs.inc8(regs.c);
        m.step(0x0adf, 4); // B>=5: C++
      }
    }

    // loc_0adf:
    mem.write8(regs.iy + 0x00, regs.c);
    m.step(0x0ae2, 19); // sprite code/flag (iy+0) <- C
    regs.de = 0x0005;
    m.step(0x0ae5, 10);
    regs.addIx(regs.de);
    m.step(0x0ae7, 15);
    regs.incMem8(mem, regs.ix + 0x01);
    m.step(0x0aea, 23);
    regs.incMem8(mem, regs.ix + 0x01);
    m.step(0x0aed, 23); // second struct (ix+1) += 2
    regs.addIx(regs.de);
    m.step(0x0aef, 15);
    regs.e = regs.dec8(regs.e);
    m.step(0x0af0, 4); // DE = 4
    regs.addIy(regs.de);
    m.step(0x0af2, 15); // IY += 4
    if (regs.djnz() !== 0) {
      m.step(0x0a8f, 13); // djnz 0x0a8f
      continue;
    }
    m.step(0x0af4, 8);
    m.ret();
    return;
  }
}
