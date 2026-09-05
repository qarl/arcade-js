// SPDX-License-Identifier: GPL-3.0-only

// loc_1898  (ROM 0x1898-0x18a5) — dispatch the LFO/frequency updater. If the 0x41d0 request flag is 0, tail
// into the normal per-frame path loc_18a6. Otherwise clear 0x41d0, force A=0x0f and tail into loc_18b2 to
// slam that value into the four lfo_freq latches.
export function loc_1898(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x41d0);
  m.step(0x189b, 13);

  regs.and(regs.a); // Z when no request pending
  m.step(0x189c, 4);

  if (regs.fZ) {
    // jr z,loc_18a6 -- normal path
    m.step(0x18a6, 12);
    return m.call(0x18a6);
  }
  m.step(0x189e, 7);

  regs.xor(regs.a);
  m.step(0x189f, 4);

  mem.write8(0x41d0, regs.a); // 0x41d0 = 0 (consume request)
  m.step(0x18a2, 13);

  regs.a = 0x0f;
  m.step(0x18a4, 7);

  // jr loc_18b2 -- write A=0x0f into the four latches
  m.step(0x18b2, 12);
  return m.call(0x18b2);
}
