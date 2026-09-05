// SPDX-License-Identifier: GPL-3.0-only

// loc_0972  (ROM 0x0972-0x097c) — table writer (jp target of 0x0364, fall-through from loc_096f): writes A
// into the 9 even cells of the WRAM block 0x4028,0x402a,...,0x4038 (stride 2), then ret. Interior loop
// label 0x0977 is inlined as the djnz loop.
export function loc_0972(m) {
  const { regs, mem } = m;

  regs.hl = 0x4028;
  m.step(0x0975, 10); // ld hl,0x4028 -- WRAM table base

  regs.b = 0x09;
  m.step(0x0977, 7); // ld b,0x09

  for (;;) {
    // loc_0977:
    mem.write8(regs.hl, regs.a); // ld (hl),a -- WRAM cell
    m.step(0x0978, 7);

    regs.l = regs.inc8(regs.l);
    m.step(0x0979, 4); // inc l
    regs.l = regs.inc8(regs.l);
    m.step(0x097a, 4); // inc l -- stride 2

    if (regs.djnz() !== 0) {
      m.step(0x0977, 13); // djnz 0x0977 (taken)
      continue;
    }
    m.step(0x097c, 8); // djnz 0x0977 (not taken)
    break;
  }

  m.ret();
}
