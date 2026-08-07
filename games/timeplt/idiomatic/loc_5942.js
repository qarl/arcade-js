// SPDX-License-Identifier: GPL-3.0-only
/** loc_5942 — hand back the perpendicular component pair an object's heading calls for, at the
 * pace one fixed table of velocity samples sets. Choosing it is all this entry does; an incoming
 * pointer is discarded. LIVE-OUT: the pair. */

import { velocityForHeading } from "./velocityForHeading.js";

const VELOCITY_TABLE = 0x59d7;

export function loc_5942(m) {
  velocityForHeading(m, VELOCITY_TABLE);
}
