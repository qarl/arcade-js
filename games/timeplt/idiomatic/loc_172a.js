// SPDX-License-Identifier: GPL-3.0-only
/** loc_172a — enter the last of the four outer sequence phases and restart its inner index at zero.
 * Both stores are constants and neither cell is read first, so this is an unconditional jump of the
 * two-level sequence machine to a fixed place rather than a step of it. LIVE-OUT: those two cells. */

import { SEQUENCE_PHASE, SEQUENCE_SUBSTEP } from "./names.js";

const LAST_PHASE = 3;

export function loc_172a(m) {
  const { mem8 } = m;
  mem8[SEQUENCE_PHASE] = LAST_PHASE;
  mem8[SEQUENCE_SUBSTEP] = 0;
}
