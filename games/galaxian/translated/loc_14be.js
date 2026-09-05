// SPDX-License-Identifier: GPL-3.0-only

// loc_14be  (ROM 0x14be-0x14f2) — scan trigger-flag blocks. First scan 0x4176..0x4179 (B=4): the FIRST
// set flag diverts to the loc_14d7 spawn arm. If none set, scan 0x4165..0x4168 (B=4): a set flag tail-jumps
// to loc_1446, else ret. The loc_14d7 arm (jr-nz target, inlined) spawns a primary struct at IX=0x42d0 via
// loc_145c, backs HL up by 0x11, then walks B=3 flags from there spawning secondaries via loc_148e (IY=0x42f0,
// C=2). Interior loop tops loc_14c3/loc_14ce/loc_14ea and the divert arm loc_14d7 are inlined.
export function loc_14be(m) {
  const { regs, mem } = m;

  regs.hl = 0x4176;
  m.step(0x14c1, 10); // ld hl,0x4176 -- first trigger block

  regs.b = 0x04;
  m.step(0x14c3, 7); // ld b,0x04

  let divert = false;
  for (;;) {
    // loc_14c3 (first-scan loop top)
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x14c5, 12); // bit 0,(hl)

    if (regs.fNZ) {
      m.step(0x14d7, 12); // jr nz,0x14d7 (taken) -- flag set: to the spawn arm
      divert = true;
      break;
    }
    m.step(0x14c7, 7); // jr nz (not taken)

    regs.l = regs.inc8(regs.l);
    m.step(0x14c8, 4); // inc l

    if (regs.djnz() !== 0) { m.step(0x14c3, 13); continue; } // djnz (taken)
    m.step(0x14ca, 8); // djnz (not taken)
    break;
  }

  if (!divert) {
    // loc_14ca: no first-block flag set -> scan the second block
    regs.l = 0x65;
    m.step(0x14cc, 7); // ld l,0x65 -- HL = 0x4165

    regs.b = 0x04;
    m.step(0x14ce, 7); // ld b,0x04

    for (;;) {
      // loc_14ce (second-scan loop top)
      regs.bit(0, mem.read8(regs.hl));
      m.step(0x14d0, 12); // bit 0,(hl)

      if (regs.fNZ) {
        m.step(0x1446, 10); // jp nz,0x1446 (taken) -- tail to loc_1446
        return m.call(0x1446);
      }
      m.step(0x14d3, 10); // jp nz (not taken)

      regs.l = regs.inc8(regs.l);
      m.step(0x14d4, 4); // inc l

      if (regs.djnz() !== 0) { m.step(0x14ce, 13); continue; } // djnz (taken)
      m.step(0x14d6, 8); // djnz (not taken)
      break;
    }

    m.ret(); // ret @14d6
    return;
  }

  // loc_14d7: reached via jr nz from the first scan -- spawn arm
  regs.ix = 0x42d0;
  m.step(0x14db, 14); // ld ix,0x42d0 -- primary object struct

  m.push16(0x14de);
  m.step(0x145c, 17); // call 0x145c -- spawn into (ix)
  m.call(0x145c);

  regs.a = regs.l;
  m.step(0x14df, 4); // ld a,l

  regs.sub(0x11);
  m.step(0x14e1, 7); // sub 0x11

  regs.l = regs.a;
  m.step(0x14e2, 4); // ld l,a -- HL -= 0x11, back to the trigger block

  regs.iy = 0x42f0;
  m.step(0x14e6, 14); // ld iy,0x42f0 -- secondary slot base

  regs.b = 0x03;
  m.step(0x14e8, 7); // ld b,0x03

  regs.c = 0x02;
  m.step(0x14ea, 7); // ld c,0x02 -- secondary-slot budget

  for (;;) {
    // loc_14ea (spawn-scan loop top)
    regs.bit(0, mem.read8(regs.hl));
    m.step(0x14ec, 12); // bit 0,(hl)

    if (regs.fNZ) {
      m.push16(0x14ef);
      m.step(0x148e, 17); // call nz,0x148e (taken) -- propagate to a secondary slot
      m.call(0x148e);
    } else {
      m.step(0x14ef, 10); // call nz (not taken)
    }

    regs.l = regs.inc8(regs.l);
    m.step(0x14f0, 4); // inc l

    if (regs.djnz() !== 0) { m.step(0x14ea, 13); continue; } // djnz (taken)
    m.step(0x14f2, 8); // djnz (not taken)
    break;
  }

  m.ret(); // ret @14f2
}
