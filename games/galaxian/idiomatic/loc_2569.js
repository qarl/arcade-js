// SPDX-License-Identifier: GPL-3.0-only
// Convert a binary byte to packed BCD: the value modulo 100 as two decimal digits, tens in the
// high nibble and units in the low nibble. Returns it in the accumulator.
export function loc_2569(m, value = m.regs.a) {
  const twoDigit = value % 100;
  const packed = (Math.floor(twoDigit / 10) << 4) | (twoDigit % 10);
  return (m.regs.a = packed);
}
