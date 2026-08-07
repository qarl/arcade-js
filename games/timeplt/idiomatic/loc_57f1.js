// SPDX-License-Identifier: GPL-3.0-only
/** loc_57f1 — request one sound, with no permission test: it sounds whether or not a game runs.
 * Its code is fetched from a byte of the program image. LIVE-OUT: memory. */

import { loc_5628 } from "./loc_5628.js";

const SOUND_CODE_CELL = 0x322e;

export function loc_57f1(m) {
  loc_5628(m, m.mem8[SOUND_CODE_CELL]);
}
