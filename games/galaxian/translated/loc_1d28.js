// SPDX-License-Identifier: GPL-3.0-only

// loc_1d28  (ROM 0x1d28-0x1d38) — head of the twin-counter tile-strip updater. Pets the watchdog, reads
// the 0x4008 gate byte; if zero it skips the strip redraw and tail-jumps to the 0x4009 branch (loc_1d51).
// Otherwise it switches to the alt register set, loads the VRAM write cursor from (0x400b), sets B=16
// pairs, and falls into the 0x30/0x32 fill loop (loc_1d39). Note 0x4008 stays in the MAIN HL across the
// exx, so the alt set carries it to loc_1d43's dec (hl).
export function loc_1d28(m) {
  const { regs, mem } = m;

  regs.hl = 0x4008;
  m.step(0x1d2b, 10); // 0x4008 = gate byte; also the counter cell dec'd after the exx

  regs.a = mem.read8(0x7800);
  m.step(0x1d2e, 13); // 0x7800 read = watchdog pet; A (0xff) discarded next

  regs.a = mem.read8(regs.hl);
  m.step(0x1d2f, 7); // A = 0x4008 gate byte

  regs.and(regs.a);
  m.step(0x1d30, 4);

  if (regs.fZ) {
    // jp z,0x1d51 (taken) -- gate 0: no redraw, go straight to the 0x4009 branch
    m.step(0x1d51, 10);
    return m.call(0x1d51);
  }
  m.step(0x1d33, 10); // jp z,0x1d51 (not taken)

  regs.exx();
  m.step(0x1d34, 4); // alt set; MAIN HL now the VRAM cursor, 0x4008 parked in the alt HL

  regs.hl = mem.read16(0x400b);
  m.step(0x1d37, 16); // 0x400b = live VRAM write cursor

  regs.b = 0x10;
  m.step(0x1d39, 7); // 16 tile pairs

  // fall-through into loc_1d39 (the 0x30/0x32 fill loop)
  return m.call(0x1d39);
}
