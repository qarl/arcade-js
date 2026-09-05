// SPDX-License-Identifier: GPL-3.0-only
// Derive an object's on-screen sprite position from the packed grid-cell field of its record. The row bits
// set the vertical position (a fixed top minus three-quarters of the row); the column bits set the
// horizontal position (a moving X anchor plus the column scaled up, offset by the sprite hotspot).
import { loc_420e } from "./names.js";

// Field offsets within the object record addressed by `obj`.
const PACKED_CELL = 7; // packed row/column grid cell
const SPRITE_Y = 3;
const SPRITE_X = 4;

const Y_TOP = 124; // vertical origin the row offset is subtracted from
const X_HOTSPOT = 7; // horizontal sprite-hotspot offset

export function loc_1147(m, obj = m.regs.ix) {
  const { mem8 } = m;

  const row = mem8[obj + PACKED_CELL] & 0x70; // row bits (a multiple of 16)
  mem8[obj + SPRITE_Y] = Y_TOP - ((row >> 1) + (row >> 2)); // top - 3/4 * row

  const col = mem8[obj + PACKED_CELL] & 0x0f; // column bits
  mem8[obj + SPRITE_X] = mem8[loc_420e] + (col << 4) + X_HOTSPOT;
}
