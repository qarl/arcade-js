// SPDX-License-Identifier: GPL-3.0-only
/** loc_56e4 — request two particular sounds, one after the other, and only while the cabinet is
 * allowed to make them. Neither code is an immediate: each is fetched from a byte of the program
 * image, and choosing that pair is the whole of this entry — whatever a caller was holding is
 * discarded. Both requests go through the same permission test, so an attract loop with sound
 * switched off drops both. LIVE-OUT: memory. */

import { loc_5617 } from "./loc_5617.js";

const FIRST_CODE_CELL = 0x27cb;
const SECOND_CODE_CELL = 0x33a0;

export function loc_56e4(m) {
  const { mem8 } = m;
  loc_5617(m, mem8[FIRST_CODE_CELL]);
  loc_5617(m, mem8[SECOND_CODE_CELL]);
}
