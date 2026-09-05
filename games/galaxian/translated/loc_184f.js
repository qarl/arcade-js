// SPDX-License-Identifier: GPL-3.0-only

// loc_184f  (ROM 0x184f-0x185d) — reads the 16-bit word at 0x41c7 into HL. If bit0 of the low byte is set,
// reset the word to 0x8000 and return; otherwise tail into loc_185e (which processes the high byte).
export function loc_184f(m) {
  const { regs, mem } = m;

  regs.hl = mem.read16(0x41c7);
  m.step(0x1852, 16); // ld hl,(0x41c7)

  regs.bit(0, regs.l);
  m.step(0x1854, 8); // bit 0,l -- Z = !(bit0 of low byte)

  if (regs.fZ) {
    // jp z,0x185e (taken) -- bit0 clear: delegate to loc_185e
    m.step(0x185e, 10);
    return m.call(0x185e);
  }
  m.step(0x1857, 10); // jp z,0x185e (not taken)

  regs.hl = 0x8000;
  m.step(0x185a, 10); // ld hl,0x8000

  mem.write16(0x41c7, regs.hl); // ld (0x41c7),hl -- reset word to 0x8000
  m.step(0x185d, 16);

  m.ret();
}
