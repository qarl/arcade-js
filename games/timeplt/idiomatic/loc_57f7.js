// SPDX-License-Identifier: GPL-3.0-only
/** loc_57f7 — request the sound that belongs to the era now being played, and only while a game
 * is in progress. It does not ask for a fixed sound: the era index picks one of a contiguous run
 * of codes beginning at a fixed offset, so each era gets its own. LIVE-OUT: memory. */

import { loc_560c } from "./loc_560c.js";
import { ERA_INDEX } from "./names.js";
import { u8 } from "../../../core/int.js";

const FIRST_ERA_CODE = 12;

export function loc_57f7(m) {
  loc_560c(m, u8(m.mem8[ERA_INDEX] + FIRST_ERA_CODE));
}
