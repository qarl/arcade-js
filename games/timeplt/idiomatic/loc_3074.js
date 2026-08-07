// SPDX-License-Identifier: GPL-3.0-only
/** loc_3074 — carry an object onto one more sprite entry, offset from the one it already occupies
 * by an amount a table supplies. The entry one stride on takes one coordinate straight from the
 * register the caller loaded it into, and the other displaced by the byte the caller's pointer
 * selects — so the shape of the offset belongs to the table, not to any arithmetic here. Both
 * cursors then step onto the entry just written. LIVE-OUT: the two bytes, the cursors, the sum. */

import { advanceToNextSlot } from "./advanceToNextSlot.js";

const ENTRY_STRIDE = 2;
const SECOND_AXIS_OFFSET = 49;

export function loc_3074(m) {
  const { mem8, regs } = m;
  const nextEntry = regs.iy + ENTRY_STRIDE;

  regs.a = mem8[regs.hl] + regs.c;
  mem8[nextEntry + SECOND_AXIS_OFFSET] = regs.b;
  mem8[nextEntry] = regs.a;
  advanceToNextSlot(m);
}
