// SPDX-License-Identifier: GPL-3.0-only

// loc_1b1b  (ROM 0x1B1B-0x1B2C) — reached after the strided-copy loop (loc_1b13 falls through). Clears the
// irq_enable latch (0x7001 D0 -> NMI off), pets the watchdog (0x7800), reads IN0 (0x6000) and spins while
// bit 6 is set; once clear, jumps to reset vector 0x0000 (cold reboot). The "message shown, now wait then
// reboot" tail: NMI off so nothing repaints, watchdog fed each pass so the board doesn't hard-reset.
export function loc_1b1b(m) {
  const { regs, mem } = m;

  for (;;) {
    // loc_1b1b:
    regs.xor(regs.a);
    m.step(0x1b1c, 4); // xor a -- A=0

    mem.write8(0x7001, regs.a, 10);
    m.step(0x1b1f, 13); // ld (0x7001),a -- irq_enable D0=0 (NMI off); ld (nn),a busOffset=10

    regs.a = mem.read8(0x7800);
    m.step(0x1b22, 13); // ld a,(0x7800) -- watchdog reset_r (pet the dog; returns 0xFF)

    regs.a = mem.read8(0x6000);
    m.step(0x1b25, 13); // ld a,(0x6000) -- IN0

    regs.and(0x40);
    m.step(0x1b27, 7); // and 0x40 -- test IN0 bit 6

    if (regs.fNZ) {
      m.step(0x1b1b, 10); // jp nz,0x1b1b (taken) -- keep spinning while bit 6 set
      continue;
    }
    m.step(0x1b2a, 10); // jp nz (not taken) -- bit 6 clear, fall to the reboot
    break;
  }

  // jp 0x0000 -- reset vector (owned by loc_0000); tail-jump, propagate its result
  m.step(0x0000, 10);
  return m.call(0x0000);
}
