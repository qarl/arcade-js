// SPDX-License-Identifier: GPL-3.0-only

// loc_1be3  (ROM 0x1BE3-0x1BEC) — OBJRAM color-ramp fill. Starting from A (the seed) and HL (0x5800 =
// OBJRAM, set by loc_1bcd), write A to (HL), add 0x2F, INC L, and loop until L wraps to 0 (0x100 bytes) —
// laying a stepped color ramp across OBJRAM. Then reload A from (0x401e) and FALL THROUGH into loc_1bed
// (which re-scans the ramp). Reached only via loc_1bcd (HL always in 0x58xx OBJRAM) and its own loop, so
// `ld (hl),a` never targets a hardware latch — no bus-cycle offset.
//   1be3  77        ld (hl),a         1be4  c6 2f     add a,0x2f    1be6  2c        inc l
//   1be7  c2 e3 1b  jp nz,0x1be3      1bea  3a 1e 40  ld a,(0x401e)
export function loc_1be3(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1be3:
    mem.write8(regs.hl, regs.a);
    m.step(0x1be4, 7); // ld (hl),a -- OBJRAM write (0x58xx)

    regs.add(0x2f);
    m.step(0x1be6, 7); // add a,0x2f -- step the ramp

    regs.l = regs.inc8(regs.l);
    m.step(0x1be7, 4); // inc l -- Z iff L wrapped to 0

    if (regs.fNZ) {
      m.step(0x1be3, 10); // jp nz,0x1be3 (taken)
      continue;
    }
    m.step(0x1bea, 10); // jp nz,0x1be3 (not taken)
    break;
  }

  regs.a = mem.read8(0x401e);
  m.step(0x1bed, 13); // ld a,(0x401e) -- reload seed for the re-scan

  // fall-through into loc_1bed (ramp re-scan / verify) -- delegate, do not inline
  return m.call(0x1bed);
}
