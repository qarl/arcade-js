// SPDX-License-Identifier: GPL-3.0-only

// loc_1c30  (ROM 0x1C30-0x1C39) — a page-fill loop: store A into (HL) advancing L until it wraps to 0
// (256 bytes of the 0x??00 page), then load A=3 and tail-jump into loc_1b04. Entered from loc_1c2c with
// HL=0x5800 / A=0 (clear OBJRAM), or directly with the caller's HL/A.
//   [code]-level (instruction-faithful lift); MAME-grounding pending.
//   1c30  77        ld (hl),a
//   1c31  2c        inc l
//   1c32  c2 30 1c  jp nz,0x1c30
//   1c35  3e 03     ld a,0x03
//   1c37  c3 04 1b  jp 0x1b04
export function loc_1c30(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1c30:
    mem.write8(regs.hl, regs.a, 4);
    m.step(0x1c31, 7); // ld (hl),a -- busOffset 4: HL may target a hardware latch

    regs.l = regs.inc8(regs.l);
    m.step(0x1c32, 4); // inc l

    // jp nz,0x1c30
    if (regs.fNZ) {
      m.step(0x1c30, 10); // jp nz (taken) -- loop until L wraps to 0
      continue;
    }
    m.step(0x1c35, 10); // jp nz (not taken) -- page filled
    break;
  }

  regs.a = 0x03;
  m.step(0x1c37, 7); // ld a,0x03

  // jp 0x1b04 -- tail-jump into loc_1b04
  m.step(0x1b04, 10);
  return m.call(0x1b04);
}
