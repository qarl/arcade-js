// SPDX-License-Identifier: GPL-3.0-only
// Once-every-other-frame decaying sound sweep. While its countdown is non-zero,
// on even frames it emits the countdown (rotated right two bits) to SOUND_W_REG4
// and ticks the countdown down one step, so the emitted value shrinks to silence.
import { loc_4007, loc_41df, SOUND_W_REG4 } from "./names.js";

export function loc_16a6(m) {
  const { mem8 } = m;

  // Even-frame gate: act only when bit 0 of the frame flag is clear.
  if (mem8[loc_4007] & 0x01) return;

  // Sweep gate: nothing to do once the countdown has drained to zero.
  const countdown = mem8[loc_41df];
  if (countdown === 0) return;

  // Emit the countdown rotated right two bits, then tick the sweep down one step.
  mem8[SOUND_W_REG4] = (countdown >> 2) | (countdown << 6);
  mem8[loc_41df] = countdown - 1;
}
