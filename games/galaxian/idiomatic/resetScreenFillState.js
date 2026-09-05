// SPDX-License-Identifier: GPL-3.0-only
// Input-gated re-seed of the screen-fill state. Unless IN0 bit 6 is asserted, rewind the
// VRAM write cursor to the top of video RAM, arm the fill-length counter to a full page,
// clear the alternate-dispatch flag, and reset the game-state index to 0.
import { IN0, VRAM_WRITE_PTR, VRAM_BASE, loc_4008, loc_401a, GAME_STATE } from "./names.js";

// A full page of VRAM rows.
const FILL_LENGTH = 32;

export function resetScreenFillState(m) {
  const { mem8, mem16 } = m;

  // Input gate: if IN0 bit 6 is asserted, leave the fill state untouched.
  if (mem8[IN0] & 0x40) return;

  // Rewind the VRAM write cursor to the top of video RAM.
  mem16[VRAM_WRITE_PTR] = VRAM_BASE;

  // Re-arm the fill-length counter; clear the dispatch flag and game state.
  mem8[loc_4008] = FILL_LENGTH;
  mem8[loc_401a] = 0;
  mem8[GAME_STATE] = 0;
}
