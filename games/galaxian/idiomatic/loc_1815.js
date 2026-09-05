// SPDX-License-Identifier: GPL-3.0-only
// Stage the pitch value: park the byte in A into SOUND_PITCH, the shadow cell the per-frame driver
// later latches out to the pitch port. Writes that cell and nothing else.
import { SOUND_PITCH } from "./names.js";

// A is the value to stage; defaults to the live A register so a still-Z80 caller reaches the same path.
export function loc_1815(m, value = m.regs.a) {
  const { mem8 } = m;

  // Park the pitch value; the driver latches it to the pitch port later this frame.
  mem8[SOUND_PITCH] = value;
}
