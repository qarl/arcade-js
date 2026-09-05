// SPDX-License-Identifier: GPL-3.0-only

// loc_2146  (ROM 0x2146-0x2149) — index the 0x215b byte-table by A (rst 0x20 -> A=(0x215b+A)), then fall
// through into loc_214a.
export function loc_2146(m) {
  const { regs } = m;

  regs.hl = 0x215b; // byte-table base
  m.step(0x2149, 10);

  m.push16(0x214a);
  m.step(0x0020, 11); // rst 0x20 -> A=(0x215b+A), HL=0x215b+A
  m.call(0x0020);

  return m.call(0x214a); // fall through into loc_214a
}
