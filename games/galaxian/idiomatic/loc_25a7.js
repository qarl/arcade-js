// SPDX-License-Identifier: GPL-3.0-only
// Stamps a vertical tile pair from the fixed seed code: the double-height glyph writer paints the seed at
// HL and the stepped code one tilemap row below. Memory only.
import { drawDoubleHeightTile as loc_25a9 } from "./drawDoubleHeightTile.js";

// The fixed starting tile/glyph code this entry point seeds.
const TILE_SEED = 44;

export function loc_25a7(m, dest = m.regs.hl) {
  loc_25a9(m, TILE_SEED, dest);
}
