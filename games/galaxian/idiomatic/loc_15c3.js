// SPDX-License-Identifier: GPL-3.0-only
// Delayed one-shot: while armed, counts the delay down and does nothing until it hits zero. On the
// zero tick it disarms and, only if both enable flags are set, raises the request.
import { DELAYED_EVENT_ARMED, DELAYED_EVENT_TIMER, DELAYED_EVENT_REQUEST, OBJ_ACTIVE_FLAG, loc_41ef } from "./names.js";

export function loc_15c3(m) {
  const { mem8 } = m;

  if (!(mem8[DELAYED_EVENT_ARMED] & 0x01)) return;

  mem8[DELAYED_EVENT_TIMER] = mem8[DELAYED_EVENT_TIMER] - 1;
  if (mem8[DELAYED_EVENT_TIMER] !== 0) return;

  mem8[DELAYED_EVENT_ARMED] = 0; // one-shot: disarm

  if (!(mem8[OBJ_ACTIVE_FLAG] & 0x01)) return;
  if (!(mem8[loc_41ef] & 0x01)) return;
  mem8[DELAYED_EVENT_REQUEST] = 1;
}
