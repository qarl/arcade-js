// SPDX-License-Identifier: GPL-3.0-only
// When the gate byte is nonzero: advance the game-state counter, then clear a cluster of state/flag cells
// (the frame flag, the sequence step, a state flag, the sound-sweep countdown, and the scroller enable).
// A zero gate does nothing.
import {
  loc_4002,
  GAME_STATE,
  loc_4007,
  SEQUENCE_STATE,
  loc_41c2,
  loc_41df,
  MESSAGE_SCROLL_ENABLE,
} from "./names.js";

export function loc_03d7(m) {
  const { mem8 } = m;

  if (mem8[loc_4002] === 0) return;

  mem8[GAME_STATE] = mem8[GAME_STATE] + 1; // byte store wraps 255 -> 0
  mem8[loc_4007] = 0;
  mem8[SEQUENCE_STATE] = 0;
  mem8[loc_41c2] = 0;
  mem8[loc_41df] = 0;
  mem8[MESSAGE_SCROLL_ENABLE] = 0;
}
