// SPDX-License-Identifier: GPL-3.0-only
// Even-frame hum driver: tally a 6x10 flag grid (seeded at 1), then light that many of the
// three sound-write latches (capped at three) and zero any past that point. Raises a flag
// once the tally has nearly run dry.
import { loc_4007, OCCUPANCY_GRID, loc_4224, SOUND_W_REG0, SOUND_W_REG1, SOUND_W_REG2 } from "./names.js";

const ROWS = 6, COLS = 10, ROW_STRIDE = 16;

export function loc_16b8(m) {
  const { mem8 } = m;

  // Act only on even frames (bit 0 of the frame flag clear).
  if (mem8[loc_4007] & 0x01) return;

  // Sum the grid into an 8-bit tally, seeded at 1.
  let tally = 1;
  for (let row = 0; row < ROWS; row++) {
    const base = OCCUPANCY_GRID + row * ROW_STRIDE;
    for (let col = 0; col < COLS; col++) tally = (tally + mem8[base + col]) & 0xff;
  }

  // Light one latch per unit of tally, stopping the instant it drains to zero (capped at three);
  // zero every latch from the stopping point onward.
  const latch = [SOUND_W_REG0, SOUND_W_REG1, SOUND_W_REG2];
  let i = 0;
  for (; i < latch.length; i++) {
    tally = (tally - 1) & 0xff;
    if (tally === 0) break;
    mem8[latch[i]] = 1;
  }
  for (; i < latch.length; i++) mem8[latch[i]] = 0;

  // Raise the flag once the tally has (nearly) run dry.
  mem8[loc_4224] = tally < 2 ? 1 : 0;
}
