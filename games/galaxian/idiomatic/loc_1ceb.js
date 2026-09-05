// SPDX-License-Identifier: GPL-3.0-only
// Character-draw loop: for each of `count` chars, read a source byte, subtract the '0'
// code to map it to a tile code, store it to the destination cell, then step the source
// forward one byte and the destination by `stride` (a negative stride walks up a column).

// The '0' character code; subtracting it maps a character code to its tile code.
const CHAR_ZERO = 48;

export function loc_1ceb(m, count = m.regs.b, src = (m.regs.d_ << 8) | m.regs.e_, dest = (m.regs.h_ << 8) | m.regs.l_, stride = (m.regs.b_ << 8) | m.regs.c_) {
  const { mem8 } = m;

  // A count of 0 means a full 256 passes (the pre-decrement counter wraps).
  const passes = count === 0 ? 256 : count;

  // Address writes mask to 16 bits, so the wrap-around stride reproduces the up-a-column walk.
  let readPtr = src;
  let writePtr = dest;
  for (let i = 0; i < passes; i++) {
    mem8[writePtr] = mem8[readPtr] - CHAR_ZERO; // byte-wide write wraps mod 256
    readPtr += 1;
    writePtr += stride;
  }
}
