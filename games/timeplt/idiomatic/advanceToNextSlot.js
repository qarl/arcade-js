// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceToNextSlot — step the record cursor and the parallel sprite-entry cursor on to the next
 * object slot.
 *
 * ROM 0x309B-0x30A4 (loc_309b). Grounding: [seen] (names.js ROUTINES 0x309B).
 *
 * What it is: objects are kept in numbered slots, and each slot owns TWO things in two parallel
 * tables — a sixteen-byte record describing the object, and a two-byte sprite entry in a second table.
 * A walker over the slots holds one cursor into each table; because the two tables have
 * different strides, stepping to the next slot means adding a different amount to each cursor
 * so that both keep pointing at the SAME slot index.
 *
 * Role in the machine: the scenery routines use it — placeAbuttingTile to step onto a further tile
 * of the sprite it has just placed, driftOneTileSceneryAtThreeQuarters and driftOneTileSceneryAtHalf
 * to reach a different entity. The callers disagree about what the next slot holds, so the unit
 * this advances is the slot index, not the object.
 *
 * Nothing is read, written or clamped.
 *
 * Parameters: `record` — the cursor into the sixteen-byte records (IX in the ROM);
 *             `entry`  — the cursor into the two-byte sprite entries (IY in the ROM).
 *
 * LIVE-OUT: the two stepped cursors.
 */

import { u16 } from "../../../core/int.js";

// One slot's record is sixteen bytes (`ld de,0x0010 / add ix,de`)...
const RECORD_STRIDE = 16;
// ...and its entry in the parallel table is two (`inc iy / inc iy`).
const ENTRY_STRIDE = 2;

export function advanceToNextSlot(m, record = m.regs.ix, entry = m.regs.iy) {
  // Both cursors are stepped together, each wrapped to sixteen bits as the index registers are.
  // They are returned as a pair, which is how every caller takes them, and also left in IX and IY,
  // where the ROM leaves them for its scenery steps to read back after the call.
  return [m.regs.ix = u16(record + RECORD_STRIDE), m.regs.iy = u16(entry + ENTRY_STRIDE)];
}
