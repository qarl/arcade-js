// SPDX-License-Identifier: GPL-3.0-only

// loc_0010  (ROM 0x0010-0x0014) — the RST 10 vector: a memory FILL loop. Stores A into (HL),
// advancing HL, B times (`djnz` back onto the head), then returns. B/HL/A are set by the caller.
//   0010  77        ld (hl),a
//   0011  23        inc hl
//   0012  10 fc     djnz 0x0010
//   0014  c9        ret
export function loc_0010(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_0010:
    mem.write8(regs.hl, regs.a, 4);
    m.step(0x0011, 7); // ld (hl),a -- busOffset 4: HL may target a hardware latch

    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x0012, 6); // inc hl

    if (regs.djnz() !== 0) {
      m.step(0x0010, 13); // djnz 0x0010 (taken)
      continue;
    }
    m.step(0x0014, 8); // djnz 0x0010 (not taken) -- fill complete
    break;
  }

  m.ret();
}
