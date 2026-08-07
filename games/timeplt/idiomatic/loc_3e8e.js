// SPDX-License-Identifier: GPL-3.0-only
/** loc_3e8e — run down one slot's counter for a frame, and take the slot out of play as soon as
 * it has nothing left to run. Two things end it outright: the era cell not standing at the last
 * era, and the counter already sitting one above the floor. Otherwise the counter drops by one;
 * a counter that came in at or above a high mark is clamped by the step this hands to, and the
 * slot then drifts with the world. What the counter reads AFTERWARDS — the clamp may have moved
 * it — picks the shape: below a threshold nothing more is done, and from there up the count is
 * folded into one of eight shapes, held for four counts each and repeating past the eighth, which
 * goes into the sprite entry together with one fixed byte beside it. LIVE-OUT: memory. */

import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { ERA_INDEX } from "./names.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { loc_3ecb } from "./loc_3ecb.js";
import { retireSlot } from "./retireSlot.js";

const LAST_ERA = 4;
const COUNTER = 0;
const FLOOR = 1;
const CLAMPED_FROM = 60;
const SHAPES_FROM = 28;
const HELD_FOR = 4;
const SHAPES = 8;
const SHAPE_TABLE = 0x3ec3;
const SHAPE_IN_ENTRY = 1;
const BESIDE_IT_IN_ENTRY = 48;
const BESIDE_IT = 3;

export function loc_3e8e(m) {
  const { mem8, regs } = m;

  if (mem8[ERA_INDEX] !== LAST_ERA) {
    retireSlot(m);
    return;
  }
  const wasAt = mem8[regs.ix + COUNTER];
  if (wasAt === FLOOR) {
    retireSlot(m);
    return;
  }

  mem8[regs.ix + COUNTER] = wasAt - 1;
  if (wasAt >= CLAMPED_FROM) loc_3ecb(m);
  driftWithWorldScroll(m);

  const nowAt = mem8[regs.ix + COUNTER];
  if (nowAt < SHAPES_FROM) return;

  regs.hl = SHAPE_TABLE;
  regs.a = Math.floor((nowAt - SHAPES_FROM) / HELD_FOR) % SHAPES;
  mem8[regs.iy + SHAPE_IN_ENTRY] = fetchTableByte(m);
  mem8[regs.iy + BESIDE_IT_IN_ENTRY] = BESIDE_IT;
}
