// SPDX-License-Identifier: GPL-3.0-only

// loc_11e0  (ROM 0x11e0-0x1217) — find a free slot in the 14-entry table at 0x4260 (stride 5, bit0 of
// entry[0] = active) and populate it from the object at IX. Interior loop loc_11e8 (scan), fill arm loc_11f0,
// and the negative-delta arm loc_120f are all inlined. Returns with the slot filled, or a bare ret if full.
export function loc_11e0(m) {
  const { regs, mem } = m;

  regs.de = 0x0005;
  m.step(0x11e3, 10); // entry stride

  regs.hl = 0x4260;
  m.step(0x11e6, 10); // table base

  regs.b = 0x0e;
  m.step(0x11e8, 7); // 14 entries to scan

  for (;;) {
    // loc_11e8: scan for a slot with bit0 of (hl) clear
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x11ea, 12); // bit 0,(hl) -- active flag

    if (regs.fZ) {
      m.step(0x11f0, 12); // jr z,0x11f0 (taken) -- free slot
      break;
    }
    m.step(0x11ec, 7); // jr z (not taken)

    regs.addHl(regs.de);
    m.step(0x11ed, 11); // next entry

    if (regs.djnz() !== 0) {
      m.step(0x11e8, 13); // djnz (taken)
      continue;
    }
    m.step(0x11ef, 8); // djnz (not taken)
    m.ret(); // ret -- table full, no free slot
    return;
  }

  // loc_11f0: fill the slot at HL from the IX object
  mem.write8(regs.hl, 0x01);
  m.step(0x11f2, 10); // entry[0] = 1 -- mark active

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x11f3, 6);

  regs.a = mem.read8((regs.ix + 3) & 0xffff);
  m.step(0x11f6, 19); // A = (ix+3)

  mem.write8(regs.hl, regs.a);
  m.step(0x11f7, 7); // entry[1] = (ix+3)

  regs.a = 0xf0;
  m.step(0x11f9, 7);

  regs.sub(mem.read8(regs.hl));
  m.step(0x11fa, 7); // A = 0xf0 - entry[1]

  regs.d = regs.a;
  m.step(0x11fb, 4);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x11fc, 6);

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x11fd, 6);

  regs.a = mem.read8((regs.ix + 4) & 0xffff);
  m.step(0x1200, 19); // A = (ix+4)

  mem.write8(regs.hl, regs.a);
  m.step(0x1201, 7); // entry[3] = (ix+4)

  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x1202, 6);

  regs.a = mem.read8(0x4202);
  m.step(0x1205, 13); // A = (0x4202)

  regs.sub(mem.read8((regs.ix + 4) & 0xffff));
  m.step(0x1208, 19); // A = (0x4202) - (ix+4) -- delta

  if (regs.fC) {
    m.step(0x120f, 12); // jr c,0x120f (taken) -- negative delta

    // loc_120f: |delta| through the scaler, restore sign
    regs.neg();
    m.step(0x1211, 8);

    m.push16(0x1214);
    m.step(0x1218, 17); // call 0x1218
    m.call(0x1218);

    regs.neg();
    m.step(0x1216, 8);

    mem.write8(regs.hl, regs.a);
    m.step(0x1217, 7); // entry[4] = -scale(|delta|)

    m.ret();
    return;
  }
  m.step(0x120a, 7); // jr c (not taken)

  m.push16(0x120d);
  m.step(0x1218, 17); // call 0x1218
  m.call(0x1218);

  mem.write8(regs.hl, regs.a);
  m.step(0x120d, 7); // entry[4] = scale(delta)

  m.ret();
}
