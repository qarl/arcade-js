// SPDX-License-Identifier: GPL-3.0-only
// Paints a double-height glyph: the caller's tile at the top cell (HL) and tile+2 in the cell one tilemap
// row (+32) below. Memory only.

// One tilemap row is 32 cells, so the bottom half sits directly beneath the top half.
const ROW_STRIDE = 32;

// The bottom half's tile code is the top half's + 2 — the second glyph in a top/bottom pair.
const BOTTOM_TILE_STEP = 2;

export function drawDoubleHeightTile(m, tile = m.regs.a, dest = m.regs.hl) {
  const { mem8 } = m;

  // top half at HL, bottom half one row below with the tile code stepped by 2
  mem8[dest] = tile;
  mem8[dest + ROW_STRIDE] = tile + BOTTOM_TILE_STEP;
}
