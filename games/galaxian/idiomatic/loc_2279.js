// SPDX-License-Identifier: GPL-3.0-only
// Paints one BCD digit glyph into the cursor cell, then advances the cursor. Suppresses leading zeros:
// while the blank counter is nonzero a leading zero draws a blank tile and decrements it; the first
// significant digit ends suppression. Returns the advanced cursor (IX) and blank counter (C).

// Glyph tile for '0'; digits '0'..'9' are the contiguous tiles 0x90..0x99, so digit d -> 0x90 + d.
const DIGIT_TILE_BASE = 0x90;

// Base for a blanked leading zero: 0x80 + 0x90 wraps (mod 256) to tile 0x10, the blank tile.
const BLANK_BASE = 0x80;

export function loc_2279(m, digit = m.regs.a, blank = m.regs.c, dest = m.regs.ix, stride = m.regs.de) {
  const { mem8 } = m;

  digit &= 0x0f; // isolate the BCD nibble

  let base;
  if (digit !== 0) {
    // significant digit: draw its glyph, stop blanking
    base = digit;
    blank = 0;
  } else if (blank !== 0) {
    // leading zero while blanking: draw blank, consume one slot
    base = BLANK_BASE;
    blank = blank - 1;
  } else {
    // zero after blanking finished: draw a real '0'
    base = 0;
  }

  mem8[dest] = base + DIGIT_TILE_BASE;

  return (m.regs.ix = dest + stride, m.regs.c = blank);
}
