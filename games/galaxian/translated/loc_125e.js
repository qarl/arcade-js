// SPDX-License-Identifier: GPL-3.0-only

// loc_125e  (ROM 0x125e-0x1291) — deactivate the object at IX (clear (ix+0), (ix+1)=1, (ix+2)=0) and
// raise a sound/score request. Scans B=3 bands of (ix+7) against C=0x50 (each miss bumps E and drops A by
// 0x10); a match tail-jumps to 0x08f2 with E as the param. On exhaust: (0x422b)=0xf001, and if (0x422a)==2
// add the loc_1292 neighbour bonus into A -> (0x422d), fold A into E, then tail-jump 0x08f2.
// Interior band-scan top loc_1273 inlined. Entered by fall-through from loc_123f and jp from loc_12b6/12da.
export function loc_125e(m) {
  const { regs, mem } = m;

  mem.write8((regs.ix + 0x00) & 0xffff, 0x00);
  m.step(0x1262, 19); // (ix+0) = 0 -- deactivate
  mem.write8((regs.ix + 0x01) & 0xffff, 0x01);
  m.step(0x1266, 19);
  mem.write8((regs.ix + 0x02) & 0xffff, 0x00);
  m.step(0x126a, 19);

  regs.de = 0x0304; // D=3, E=4 (sprite/sound param seed)
  m.step(0x126d, 10);
  regs.bc = 0x0350; // B=3 bands, C=0x50 threshold
  m.step(0x1270, 10);
  regs.a = mem.read8((regs.ix + 0x07) & 0xffff);
  m.step(0x1273, 19); // A = (ix+7)

  for (;;) {
    // loc_1273: band scan
    regs.cp(regs.c);
    m.step(0x1274, 4);
    if (regs.fC) {
      m.step(0x08f2, 10); // jp c,0x08f2 -- band matched, tail-jump with E
      return m.call(0x08f2);
    }
    m.step(0x1277, 10);
    regs.e = regs.inc8(regs.e);
    m.step(0x1278, 4);
    regs.sub(0x10);
    m.step(0x127a, 7);
    if (regs.djnz() !== 0) { m.step(0x1273, 13); continue; }
    m.step(0x127c, 8);
    break;
  }

  regs.hl = 0xf001;
  m.step(0x127f, 10);
  mem.write16(0x422b, regs.hl);
  m.step(0x1282, 16); // (0x422b) = 0xf001
  regs.a = mem.read8(0x422a);
  m.step(0x1285, 13);
  regs.cp(0x02);
  m.step(0x1287, 7);
  if (regs.fZ) {
    m.push16(0x128a);
    m.step(0x1292, 17); // call z,0x1292 -- fold neighbour bonus into A
    m.call(0x1292);
  } else {
    m.step(0x128a, 10);
  }

  mem.write8(0x422d, regs.a);
  m.step(0x128d, 13); // (0x422d) = A
  regs.add(regs.e);
  m.step(0x128e, 4);
  regs.e = regs.a;
  m.step(0x128f, 4);

  m.step(0x08f2, 10); // jp 0x08f2 -- tail-jump with the folded param
  return m.call(0x08f2);
}
