// SPDX-License-Identifier: GPL-3.0-only

// loc_1964  (ROM 0x1964-0x1970) — toggle/advance on the 0x4001 flag. If bit0 of 0x4001 is clear, set it via
// loc_1971 and return; else clear 0x4001, step HL to 0x4002 and tail into loc_194f to advance that counter.
export function loc_1964(m) {
  const { regs, mem } = m;

  regs.hl = 0x4001;
  m.step(0x1967, 10); // ld hl,0x4001

  regs.bit(0, mem.read8(regs.hl)); // Z = 0x4001 bit0 clear
  m.step(0x1969, 12); // bit 0,(hl)

  if (regs.fZ) {
    // jr z,0x1971 (taken) -- bit0 clear: set 0x4001 (separate head)
    m.step(0x1971, 12);
    return m.call(0x1971);
  }
  m.step(0x196b, 7); // jr z (not taken)

  mem.write8(regs.hl, 0x00);
  m.step(0x196d, 10); // ld (hl),0x00 -- clear 0x4001

  regs.l = regs.inc8(regs.l);
  m.step(0x196e, 4); // inc l -- HL -> 0x4002

  // jp 0x194f -- advance the 0x4002 counter
  m.step(0x194f, 10);
  return m.call(0x194f);
}
