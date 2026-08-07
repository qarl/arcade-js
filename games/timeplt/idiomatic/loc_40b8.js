// SPDX-License-Identifier: GPL-3.0-only
/** loc_40b8 — ask for one sound, but only when four separate conditions hold at once: the era
 * cell has climbed to at least the third era, the free-running counter's low five bits have just
 * come round to zero, and none of three watched bytes is all-ones. Any one of them failing ends
 * the entry with nothing done. Nothing is written here on either path — the whole content is the
 * four tests and the request they gate. LIVE-OUT: memory, through the request. */

import { ERA_INDEX, FRAME_TICK } from "./names.js";
import { loc_5679 } from "./loc_5679.js";

const FIRST_ERA_THAT_ASKS = 2;
const ONE_FRAME_IN = 32;
const WATCHED = [0xa8c0, 0xa8d0, 0xa8e0];
const ALL_ONES = 255;

export function loc_40b8(m) {
  const { mem8 } = m;
  if (mem8[ERA_INDEX] < FIRST_ERA_THAT_ASKS) return;
  if (mem8[FRAME_TICK] % ONE_FRAME_IN !== 0) return;
  if (WATCHED.some((cell) => mem8[cell] === ALL_ONES)) return;
  loc_5679(m);
}
