// SPDX-License-Identifier: GPL-3.0-only
/** loc_567e — request one sound, admitted while a game runs or the cabinet may sound in attract.
 * Its code is fetched from a byte of the program image. LIVE-OUT: memory. */

import { loc_5617 } from "./loc_5617.js";

const SOUND_CODE_CELL = 0x3270;

export function loc_567e(m) {
  loc_5617(m, m.mem8[SOUND_CODE_CELL]);
}
