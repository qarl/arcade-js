// SPDX-License-Identifier: GPL-3.0-only
// Init a play field: turn both start lamps off, clear four work-RAM spans, set two flag bytes, advance the
// sequence step, arm its dwell timer, and point the VRAM fill cursor at the tile grid base.
import {
  START_LAMP_0,
  START_LAMP_1,
  FLAG_BITS_BASE,
  loc_425f,
  OBJ_ACTIVE_FLAG,
  loc_4218,
  loc_4226,
  loc_4260,
  SEQUENCE_STATE,
  loc_4009,
  VRAM_WRITE_PTR,
  VRAM_BASE,
} from "./names.js";

const DWELL_TIMER_START = 32;

export function loc_0550(m) {
  const { mem8, mem16 } = m;

  mem8[START_LAMP_0] = 0;
  mem8[START_LAMP_1] = 0;

  for (let i = 0; i < 128; i++) mem8[FLAG_BITS_BASE + i] = 0;
  mem8[loc_425f] = 0;
  for (let i = 0; i < 23; i++) mem8[OBJ_ACTIVE_FLAG + i] = 0; // two spans with a one-byte gap between them
  for (let i = 0; i < 24; i++) mem8[loc_4218 + i] = 0;
  for (let i = 0; i < 70; i++) mem8[loc_4260 + i] = 0;

  mem8[loc_4226] = 1;
  mem8[SEQUENCE_STATE]++;
  mem8[loc_4009] = DWELL_TIMER_START;
  mem16[VRAM_WRITE_PTR] = VRAM_BASE;
}
