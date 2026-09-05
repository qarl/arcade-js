// SPDX-License-Identifier: GPL-3.0-only

// loc_214a  (ROM 0x214a-0x214d) — swap DE/HL and tail-jump to 0x2585.
export function loc_214a(m) {
  const { regs } = m;

  regs.exDeHl();
  m.step(0x214b, 4);

  m.step(0x2585, 10); // jp 0x2585
  return m.call(0x2585);
}
