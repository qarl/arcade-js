// SPDX-License-Identifier: GPL-3.0-only
// Draws a 2x2 tile block at HL from the seed tile in A: a top pair (tile, tile+1) then a bottom pair
// (tile+2, tile+3) one row (+32) below. Returns the advanced tile/pointer; leaves DE unchanged.
import { stampTilePair as loc_25a0 } from "./stampTilePair.js";

// Stride so each pair advances +1 (past the pair) then +31 = +32, one tile row down.
const ROW_STRIDE = 31;

export function loc_2585(m, tile = m.regs.a, dst = m.regs.hl) {
  const top = loc_25a0(m, tile, dst, ROW_STRIDE);
  return loc_25a0(m, top.a, top.hl, ROW_STRIDE);
}
