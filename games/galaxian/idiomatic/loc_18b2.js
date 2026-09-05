// SPDX-License-Identifier: GPL-3.0-only
// loc_18b2 -- save a sound level to SOUND_LFO_LEVEL, then broadcast it to the four LFO-frequency
// latches at SOUND_LFO_FREQ, rotating the byte right by one bit between writes.
import { SOUND_LFO_LEVEL, SOUND_LFO_FREQ } from "./names.js";

const LATCH_COUNT = 4;

export function loc_18b2(m, level = m.regs.a) {
  const { mem8 } = m;

  mem8[SOUND_LFO_LEVEL] = level;

  let value = level & 0xff;
  for (let i = 0; i < LATCH_COUNT; i++) {
    mem8[SOUND_LFO_FREQ + i] = value;
    value = (value >> 1) | ((value & 1) << 7); // rrca: bit 0 wraps into bit 7
  }
}
