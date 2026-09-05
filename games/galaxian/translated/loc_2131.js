// SPDX-License-Identifier: GPL-3.0-only

// loc_2131  (ROM 0x2131-0x213c) — on carry in, branch to loc_213d; else index the 0x2157 byte-table by B
// (rst 0x20 -> A=(0x2157+B)), swap DE/HL back and tail-jump to 0x25a9.
export function loc_2131(m) {
  const { regs } = m;

  regs.exDeHl();
  m.step(0x2132, 4);

  if (regs.fC) {
    m.step(0x213d, 12); // jr c,loc_213d (taken)
    return m.call(0x213d);
  }
  m.step(0x2134, 7); // jr c (not taken)

  regs.hl = 0x2157; // byte-table base (defb 0x41,0x35,...)
  m.step(0x2137, 10);

  regs.a = regs.b; // A = table index
  m.step(0x2138, 4);

  m.push16(0x2139);
  m.step(0x0020, 11); // rst 0x20 -> A=(0x2157+B), HL=0x2157+B
  m.call(0x0020);

  regs.exDeHl();
  m.step(0x213a, 4);

  m.step(0x25a9, 10); // jp 0x25a9
  return m.call(0x25a9);
}
