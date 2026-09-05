// SPDX-License-Identifier: GPL-3.0-only
// Per-tick of a gated square-wave tone: while the duration counter is non-zero, count one off it and
// drive the frame flag's toggled bit 0 to the sound register; once spent, write 0 to silence the tone.
import { SOUND_TONE_DURATION, loc_4007, SOUND_W_REG5 } from "./names.js";

export function loc_1733(m) {
  const { mem8 } = m;

  // Default output is silence — written when the duration has run out.
  let level = 0;

  const remaining = mem8[SOUND_TONE_DURATION];
  if (remaining !== 0) {
    // Still playing: count one tick off the duration (byte store wraps mod 256).
    mem8[SOUND_TONE_DURATION] = remaining - 1;

    // Tone level = frame flag with bit 0 flipped; that bit alternates per frame, so this toggles output.
    level = mem8[loc_4007] ^ 0x01;
  }

  // Drive the level (toggled tone, or 0 when spent) to the sound register.
  mem8[SOUND_W_REG5] = level;
}
