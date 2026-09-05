// SPDX-License-Identifier: GPL-3.0-only

// loc_0363  (ROM 0x0363-0x0366) — A=0, then tail-jump into loc_0972 (the shared per-state setup run by
// several state handlers, e.g. loc_0218). Called from 0x0218/0x023f/0x0267/0x028e/0x029d.
export function loc_0363(m) {
  const { regs } = m;

  regs.xor(regs.a);
  m.step(0x0364, 4); // A=0

  // jp 0x0972 (separate routine, delegate)
  m.step(0x0972, 10);
  return m.call(0x0972);
}
