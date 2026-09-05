// SPDX-License-Identifier: GPL-3.0-only
// Stamps a tile pair and steps: writes `tile` at dst and `tile+1` at dst+1, then advances the pointer
// to the next pair slot (dst + 1 + stride) and the tile code by two. Returns the advanced { a, hl } and
// mirrors them into m.regs.
import { u16 } from "../../../core/int.js";

export function stampTilePair(m, tile = m.regs.a, dst = m.regs.hl, stride = m.regs.de) {
  const { mem8 } = m;

  // stamp the pair (byte store truncates, so tile=0xff writes 0xff then 0x00)
  mem8[dst] = tile;
  const dstNext = u16(dst + 1);
  mem8[dstNext] = tile + 1;

  // advance past the second cell by the stride, and the tile code by two
  const advancedDst = u16(dstNext + stride);
  const advancedTile = (tile + 2) & 0xff;

  return (m.regs.a = advancedTile, m.regs.hl = advancedDst, { a: advancedTile, hl: advancedDst });
}
