// SPDX-License-Identifier: GPL-3.0-only
// Sub-state-1 tick for one object record: counts a fast field down (reloading it and stepping a companion
// on elapse), then a slow field; when the slow field elapses, either retire the object, or -- past a
// position threshold -- reload the fast field, seed the companion from a global, and advance the sub-state.
import { loc_422d } from "./names.js";

// Object-record field offsets.
const FAST_TIMER = 16;
const SLOW_TIMER = 17;
const COMPANION = 18;
const SUBSTATE = 2;
const STATE_BYTE = 1;
const POS_FIELD = 7;

const FAST_RELOAD = 4;
const FAST_RELOAD_FAR = 50;
const POS_THRESHOLD = 112;
const COMPANION_BIAS = 32;

export function loc_1112(m, obj = m.regs.ix) {
  const { mem8 } = m;

  // Fast field: tick; nothing more until it elapses.
  const fast = (mem8[obj + FAST_TIMER] - 1) & 0xff;
  mem8[obj + FAST_TIMER] = fast;
  if (fast !== 0) return;

  mem8[obj + FAST_TIMER] = FAST_RELOAD;
  mem8[obj + COMPANION]++;

  // Slow field: tick; nothing more until it elapses.
  const slow = (mem8[obj + SLOW_TIMER] - 1) & 0xff;
  mem8[obj + SLOW_TIMER] = slow;
  if (slow !== 0) return;

  if (mem8[obj + POS_FIELD] >= POS_THRESHOLD) {
    mem8[obj + FAST_TIMER] = FAST_RELOAD_FAR;
    mem8[obj + COMPANION] = mem8[loc_422d] + COMPANION_BIAS;
    mem8[obj + SUBSTATE]++;
  } else {
    mem8[obj + STATE_BYTE] = 0; // retire the object
  }
}
