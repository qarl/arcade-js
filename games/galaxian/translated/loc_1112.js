// SPDX-License-Identifier: GPL-3.0-only

// loc_1112  (ROM 0x1112-0x113c) — sub-state 1: countdown field +0x10; on 0 reload +0x10=4, inc +0x12, and
// countdown field +0x11. On +0x11 hitting 0, if +0x07 < 0x70 clear +0x01, else (interior loc_112d) reload
// +0x10=0x32, set +0x12=(0x422d)+0x20 and advance state (inc +0x02). rst-0x28 dispatch target.
export function loc_1112(m) {
  const { regs, mem } = m;

  regs.decMem8(mem, (regs.ix + 0x10) & 0xffff);
  m.step(0x1115, 23); // dec (ix+0x10)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- +0x10 not elapsed
  m.step(0x1116, 5);

  mem.write8((regs.ix + 0x10) & 0xffff, 0x04);
  m.step(0x111a, 19); // ld (ix+0x10),0x04 -- reload

  regs.incMem8(mem, (regs.ix + 0x12) & 0xffff);
  m.step(0x111d, 23); // inc (ix+0x12)

  regs.decMem8(mem, (regs.ix + 0x11) & 0xffff);
  m.step(0x1120, 23); // dec (ix+0x11)

  if (regs.fNZ) { m.ret(11); return; } // ret nz -- +0x11 not elapsed
  m.step(0x1121, 5);

  regs.a = mem.read8((regs.ix + 0x07) & 0xffff);
  m.step(0x1124, 19); // ld a,(ix+0x07)

  regs.cp(0x70);
  m.step(0x1126, 7); // cp 0x70

  if (regs.fNC) {
    // jr nc,0x112d (taken) -- loc_112d: +0x07 >= 0x70
    m.step(0x112d, 12);

    mem.write8((regs.ix + 0x10) & 0xffff, 0x32);
    m.step(0x1131, 19); // ld (ix+0x10),0x32

    regs.a = mem.read8(0x422d);
    m.step(0x1134, 13); // ld a,(0x422d)

    regs.add(0x20);
    m.step(0x1136, 7); // add a,0x20

    mem.write8((regs.ix + 0x12) & 0xffff, regs.a);
    m.step(0x1139, 19); // ld (ix+0x12),a

    regs.incMem8(mem, (regs.ix + 0x02) & 0xffff);
    m.step(0x113c, 23); // inc (ix+0x02) -- advance sub-state

    m.ret();
    return;
  }
  m.step(0x1128, 7); // jr nc,0x112d (not taken)

  mem.write8((regs.ix + 0x01) & 0xffff, 0x00);
  m.step(0x112c, 19); // ld (ix+0x01),0x00

  m.ret();
}
