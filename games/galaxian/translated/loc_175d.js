// SPDX-License-Identifier: GPL-3.0-only

// loc_175d  (ROM 0x175d-0x176b) — run the loc_176c channel updater on three descriptors in turn: 0x41d2,
// then 0x41cf, then 0x41cd (the last via fall-through into loc_176c).
export function loc_175d(m) {
  const { regs } = m;

  regs.hl = 0x41d2;
  m.step(0x1760, 10);

  m.push16(0x1763);
  m.step(0x176c, 17); // call 0x176c -- update descriptor 0x41d2
  m.call(0x176c);

  regs.hl = 0x41cf;
  m.step(0x1766, 10);

  m.push16(0x1769);
  m.step(0x176c, 17); // call 0x176c -- update descriptor 0x41cf
  m.call(0x176c);

  regs.hl = 0x41cd;
  m.step(0x176c, 10);

  // fall-through into loc_176c -- update descriptor 0x41cd
  return m.call(0x176c);
}
