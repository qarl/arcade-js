// SPDX-License-Identifier: GPL-3.0-only
// Silence the sound hardware and halt the video interrupt and starfield: set the four LFO-frequency
// latches to 1, clear the eight sound registers, clear the interrupt-enable and stars-enable control
// latches, and drive the pitch latch fully high.
import {
  SOUND_LFO_FREQ, SOUND_W_REG0, SOUND_PITCH_W, IRQ_ENABLE, STARS_ENABLE,
} from "./names.js";

const LFO_LATCHES = 4;
const SOUND_REGS = 8;

export function loc_1cb5(m) {
  const { mem8 } = m;

  for (let i = 0; i < LFO_LATCHES; i++) mem8[SOUND_LFO_FREQ + i] = 1;
  for (let i = 0; i < SOUND_REGS; i++) mem8[SOUND_W_REG0 + i] = 0;

  mem8[IRQ_ENABLE] = 0; // stop the vblank interrupt
  mem8[STARS_ENABLE] = 0; // stop the starfield

  mem8[SOUND_PITCH_W] = 255; // pitch latch all bits high
}
