// SPDX-License-Identifier: GPL-3.0-only

// loc_1b64  (ROM 0x1B64-0x1B6F) — VRAM page-fill loop: store A across one 256-byte page, bump H,
// pet the watchdog (0x7800), djnz back to loc_1b62 for the next page; ret once B reaches 0.
export function loc_1b64(m) {
  const { regs, mem } = m;

  // inner store loop 0x1b64-0x1b68: fill one 256-byte page (L wraps 0x00 -> 0x00)
  for (;;) {
    mem.write8(regs.hl, regs.a);
    m.step(0x1b65, 7); // ld (hl),a -- RAM/VRAM store, no bus offset

    regs.l = regs.inc8(regs.l);
    m.step(0x1b66, 4); // inc l -- Z set when the page wraps

    if (regs.fNZ) {
      m.step(0x1b64, 10); // jp nz,0x1b64 (taken) -- next byte in this page
      continue;
    }
    m.step(0x1b69, 10); // jp nz,0x1b64 (not taken) -- page done
    break;
  }

  regs.h = regs.inc8(regs.h);
  m.step(0x1b6a, 4); // inc h -- advance to the next 256-byte page

  regs.a = mem.read8(0x7800);
  m.step(0x1b6d, 13); // ld a,(0x7800) -- watchdog reset_r (value discarded; reloaded by loc_1b62)

  if (m.regs.djnz() !== 0) {
    m.step(0x1b62, 13); // djnz 0x1b62 (taken) -- re-enter loc_1b62 for the next page
    return m.call(0x1b62);
  }
  m.step(0x1b6f, 8); // djnz 0x1b62 (not taken) -- all 4 pages filled
  m.ret();
}
