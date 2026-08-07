// SPDX-License-Identifier: GPL-3.0-only
/** loc_580b — request one particular sound, and only while a game is in progress. Its code is
 * fetched from a byte of the program image. LIVE-OUT: memory. */

import { loc_560c } from "./loc_560c.js";

const SOUND_CODE_CELL = 0x49ee;

export function loc_580b(m) {
  loc_560c(m, m.mem8[SOUND_CODE_CELL]);
}
