// SPDX-License-Identifier: GPL-3.0-only
/** loc_5860 — fly one object a single step at the pace one fixed table of velocity samples sets.
 * Choosing that table is the whole of what this entry does; a pointer a caller held on the way
 * in is discarded. LIVE-OUT: memory. */

import { flyAlongHeading } from "./flyAlongHeading.js";

const VELOCITY_TABLE = 0x2e3e;

export function loc_5860(m) {
  flyAlongHeading(m, VELOCITY_TABLE);
}
