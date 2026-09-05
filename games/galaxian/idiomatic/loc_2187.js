// SPDX-License-Identifier: GPL-3.0-only
// Blank a 4x4 tile block in video RAM: write the blank-tile code to four rows of four cells,
// stepping one row-block (32 cells) between row starts.
import { loc_51da } from "./names.js";

const BLANK_TILE = 0x40;
const SIDE = 4;       // 4x4 block
const ROW_STEP = 32;  // start-to-start stride between rows

export function loc_2187(m) {
  const { mem8 } = m;

  for (let row = 0; row < SIDE; row++) {
    const base = loc_51da + row * ROW_STEP;
    for (let col = 0; col < SIDE; col++) mem8[base + col] = BLANK_TILE;
  }
}
