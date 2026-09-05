// SPDX-License-Identifier: GPL-3.0-only
// Stamps a horizontal tile pair from the fixed seed code: hands the seed to the tile-pair stamp-and-step
// and returns its advanced tile/pointer, which the caller's loop chains into the next pair.
import { stampTilePair as loc_25a0 } from "./stampTilePair.js";

// The fixed starting tile/glyph code this entry point seeds.
const TILE_SEED = 44;

export function loc_259e(m, dst = m.regs.hl, stride = m.regs.de) {
  return loc_25a0(m, TILE_SEED, dst, stride);
}
