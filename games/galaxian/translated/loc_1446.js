// SPDX-License-Identifier: GPL-3.0-only

// loc_1446  (ROM 0x1446-0x145b) — shared free-slot finder: reached by fall-in from loc_140c (jr nz,0x1446)
// and by jp nz from loc_14ce. Scans the object table at 0x4390 downward (stride -0x20, B=4) for an entry
// whose (ix+0)/(ix+1) pair is zero; on a hit tail-jumps to the seeder loc_145c (next batch). No free slot ->
// ret. Interior label 144f inlined.
export function loc_1446(m) {
  const { regs, mem } = m;

  regs.ix = 0x4390;
  m.step(0x144a, 14);
  regs.de = 0xffe0;
  m.step(0x144d, 10); // stride -0x20
  regs.b = 0x04;
  m.step(0x144f, 7);

  // loc_144f:
  for (;;) {
    regs.a = mem.read8(regs.ix + 0x00);
    m.step(0x1452, 19);
    regs.or(mem.read8(regs.ix + 0x01));
    m.step(0x1455, 19);
    if (regs.fZ) {
      m.step(0x145c, 12); // jr z,0x145c (tail -- seed the slot)
      return m.call(0x145c);
    }
    m.step(0x1457, 7);
    regs.addIx(regs.de);
    m.step(0x1459, 15);
    if (regs.djnz() !== 0) { m.step(0x144f, 13); continue; }
    m.step(0x145b, 8);
    break;
  }

  m.ret(); // 0x145b -- no free slot
}
