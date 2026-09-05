// SPDX-License-Identifier: GPL-3.0-only

// loc_16a6  (ROM 0x16a6-0x16b7) — sound tick gated to alternate frames. Returns unless bit0 of the 0x4007
// frame flag is clear; while the 0x41df countdown is nonzero it writes the rotated countdown to sound_w reg4
// (0x6804) and decrements the countdown.
export function loc_16a6(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x4007); // 0x4007: frame flag
  m.step(0x16a9, 13);

  regs.rrca(); // C = bit0 of the frame flag
  m.step(0x16aa, 4);

  if (regs.fC) { m.ret(11); return; } // ret c -- bit0 set: skip this frame
  m.step(0x16ab, 5);

  regs.hl = 0x41df;
  m.step(0x16ae, 10);

  regs.a = mem.read8(regs.hl); // 0x41df: countdown
  m.step(0x16af, 7);

  regs.and(regs.a); // Z when countdown == 0
  m.step(0x16b0, 4);

  if (regs.fZ) { m.ret(11); return; } // ret z -- countdown exhausted
  m.step(0x16b1, 5);

  regs.rrca();
  m.step(0x16b2, 4);

  regs.rrca();
  m.step(0x16b3, 4);

  mem.write8(0x6804, regs.a, 10); // sound_w reg4; busOffset 10 (ld (nn),a)
  m.step(0x16b6, 13);

  regs.decMem8(mem, regs.hl); // dec (hl) -- 0x41df--
  m.step(0x16b7, 11);

  return m.ret();
}
