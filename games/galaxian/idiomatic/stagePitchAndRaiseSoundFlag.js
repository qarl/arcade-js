// SPDX-License-Identifier: GPL-3.0-only
// Updater for the output-shadow pair (flag byte + pitch value): stores (A - 1) mod 256 into
// SOUND_PITCH and raises the flag byte to 1, marking the pair filled for this frame.
import { loc_41c0, SOUND_PITCH } from "./names.js";

export function stagePitchAndRaiseSoundFlag(m, a = m.regs.a) {
  const { mem8 } = m;

  // Store A-1 as the value byte; the subtract is modulo 256 (A = 0 stores 255).
  const value = (a - 1) & 0xff;
  mem8[SOUND_PITCH] = value;

  // Raise the flag byte: the shadow pair is filled for this frame.
  mem8[loc_41c0] = 1;
}
