// SPDX-License-Identifier: GPL-3.0-only
/** driftNearestSceneryTriTile — drift one scenery object with the world scroll, over-travelling it a quarter, then
 * place a tile abutting it and a third set diagonally off that one, and step both cursors past.
 *
 * ROM 0x2D21-0x2D2C: three calls and a tail jump into advanceToNextSlot (0x309B).
 * Grounding: [seen] (names.js ROUTINES 0x2D21).
 *
 * ROLE IN THE MACHINE. One member of the scenery parallax family that runSceneryForEra dispatches
 * over the eight scenery slots (SCENERY_RECORD_SLOT0 0xA900 / SCENERY_ENTRY_SLOT0 0xAA30). It is
 * the NEAR object of the 1940-1982 eras (eras 1-3): at five-quarter pace it moves faster than the
 * world and so reads as in front of the playfield, and its three tiles sit on three corners of a
 * square -- the second abutting the head on one axis, the third set diagonally off the second, which puts it beside the head on the other axis; the fourth corner, diagonal to the head, is never written
 * (mechanisms.md, scenery; names.js placeDiagonallyAbuttingTile). Only the first tile drifts; the
 * others are rebuilt from it every frame, so the object never comes apart. It uses three slots.
 *
 * PARAMETERS: record = the object's 16-byte record (the ROM's IX), entry = its two-byte sprite
 * entry (IY) -- the paired cursors every slot sweep carries.
 * LIVE-OUT: memory, cursors (left on the slot after the object's last tile). */

import { driftAtFiveQuartersWorldScroll } from "./driftAtFiveQuartersWorldScroll.js";
import { placeAbuttingTile } from "./placeAbuttingTile.js";
import { placeDiagonallyAbuttingTile } from "./placeDiagonallyAbuttingTile.js";
import { advanceToNextSlot } from "./advanceToNextSlot.js";

export function driftNearestSceneryTriTile(m, record = m.regs.ix, entry = m.regs.iy) {
  // The drift and the abutting tile both read the starting slot; seed both. That tile advances the
  // cursors, so the cornering tile and the closing step read them onward.
  // 1. Head tile: move by the world scroll plus a quarter of it (call 0x2D6E).
  driftAtFiveQuartersWorldScroll(m, record, entry);
  // 2. Second tile: flush against the head, one sprite width on (call 0x3058).
  const [secondRecord, secondEntry] = placeAbuttingTile(m, entry, record);
  // 3. Third tile: diagonally off the second, 16 back on one axis and 16 on along the other
  //    (call 0x308A).
  const [thirdRecord, thirdEntry] = placeDiagonallyAbuttingTile(m, secondEntry, secondRecord);
  // 4. Step both cursors past the last tile so the caller lands on the next object's slot
  //    (tail jump 0x309B), and hand them back for the next step in the running order.
  return advanceToNextSlot(m, thirdRecord, thirdEntry);
}
