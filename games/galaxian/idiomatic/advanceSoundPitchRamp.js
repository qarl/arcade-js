// SPDX-License-Identifier: GPL-3.0-only
// Per-tick sound-pitch ramp: while the {countdown, pitch} pair still has ticks left,
// decrement it, advance the pitch by a fixed step, publish the pitch to the sound
// driver's pitch shadow, and clear the composite shadow. Idle when the countdown is 0.
import { SOUND_PITCH, loc_41c0 } from "./names.js";

// Pitch advances by this much on every active tick.
const PITCH_STEP = 4;

export function advanceSoundPitchRamp(m, ptr = m.regs.hl) {
  const { mem8 } = m;

  // The countdown sits one byte past the pointer; a drained countdown means idle this tick.
  const countdownCell = ptr + 1;
  if (mem8[countdownCell] === 0) return;

  // Active tick: consume one count (nonzero here, so no wrap).
  mem8[countdownCell]--;

  // Advance the pitch, store it back, and publish it to the pitch shadow.
  const pitchCell = countdownCell + 1;
  const pitch = mem8[pitchCell] + PITCH_STEP;
  mem8[pitchCell] = pitch;
  mem8[SOUND_PITCH] = pitch;

  // Clear the composite shadow so the frame composes cleanly.
  mem8[loc_41c0] = 0;
}
