// SPDX-License-Identifier: GPL-3.0-only

// loc_1b34  (ROM 0x1B34-0x1B55) — if IN0 & IN1 & 0x04, split C into two nibbles to VRAM
// (0x51D3 low / 0x51F3 high) as a hex readout; then DE=0x1b56 and tail-jump loc_1b0a (strided copy).
export function loc_1b34(m) {
  const { regs, mem } = m;

  regs.c = regs.a;
  m.step(0x1b35, 4); // ld c,a -- stash the packed byte

  regs.a = mem.read8(0x6000);
  m.step(0x1b38, 13); // ld a,(0x6000) -- IN0

  regs.b = regs.a;
  m.step(0x1b39, 4);

  regs.a = mem.read8(0x6800);
  m.step(0x1b3c, 13); // ld a,(0x6800) -- IN1

  regs.and(regs.b);
  m.step(0x1b3d, 4); // and b -- IN0 & IN1

  regs.and(0x04);
  m.step(0x1b3f, 7); // and 0x04 -- bit 2 set in both?

  if (regs.fZ) {
    m.step(0x1b51, 12); // jr z,0x1b51 (taken) -- skip the hex readout
  } else {
    m.step(0x1b41, 7); // jr z (not taken) -- write the hex readout

    regs.a = regs.c;
    m.step(0x1b42, 4);

    regs.and(0x0f);
    m.step(0x1b44, 7); // and 0x0f -- low nibble

    mem.write8(0x51d3, regs.a);
    m.step(0x1b47, 13); // ld (0x51d3),a -- VRAM (0x5000 block, not a hardware latch)

    regs.a = regs.c;
    m.step(0x1b48, 4);

    regs.rrca();
    m.step(0x1b49, 4);

    regs.rrca();
    m.step(0x1b4a, 4);

    regs.rrca();
    m.step(0x1b4b, 4);

    regs.rrca();
    m.step(0x1b4c, 4); // rrca -- high nibble now in bits 0-3

    regs.and(0x0f);
    m.step(0x1b4e, 7); // and 0x0f -- high nibble

    mem.write8(0x51f3, regs.a);
    m.step(0x1b51, 13); // ld (0x51f3),a -- VRAM
  }

  // loc_1b51:
  regs.de = 0x1b56;
  m.step(0x1b54, 10); // ld de,0x1b56 -- source table for the strided copy

  // jr 0x1b0a -- delegate to loc_1b0a (sets up + runs the copy); tail-jump, propagate its result
  m.step(0x1b0a, 12);
  return m.call(0x1b0a);
}
