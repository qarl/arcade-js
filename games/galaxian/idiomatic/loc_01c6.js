// SPDX-License-Identifier: GPL-3.0-only
// Sub-state setup: clears a 128-byte work-RAM block and two status bytes, points the VRAM write cursor two
// cells into the tile grid, arms a page counter, and bumps the sequence-step index.
import { VRAM_WRITE_PTR, VRAM_BASE, SEQUENCE_STATE, loc_4009, FLAG_BITS_BASE, loc_425f, loc_4224 } from "./names.js";

const BLOCK_LENGTH = 128;
const PAGE_COUNT = 32;

export function loc_01c6(m) {
  const { mem8, mem16 } = m;

  // Clear the record block and the two status bytes.
  for (let i = 0; i < BLOCK_LENGTH; i++) mem8[FLAG_BITS_BASE + i] = 0;
  mem8[loc_425f] = 0;
  mem8[loc_4224] = 0;

  // Seed the VRAM write cursor, arm the page counter, advance the sequence step.
  mem16[VRAM_WRITE_PTR] = VRAM_BASE + 2;
  mem8[loc_4009] = PAGE_COUNT;
  mem8[SEQUENCE_STATE]++;
}
