// SPDX-License-Identifier: GPL-3.0-only
/** placeTileAtTableSuppliedOffset — carry an object onto one more sprite entry, offset from the one it already occupies
 * by an amount a table supplies. The entry one stride on takes one coordinate straight from the
 * register the caller loaded it into, and the other displaced by the byte the caller's pointer
 * selects — so the shape of the offset belongs to the table, not to any arithmetic here. Both
 * cursors then step onto the entry just written. LIVE-OUT: the two bytes and the stepped cursors.
 *
 * ROM 0x3074-0x307E (frozen lift translated/loc_3074.js). names.js has no ROUTINES entry for
 * 0x3074, so this entry carries no grounding tag of its own; its only caller is loc_307f
 * (0x307F) [code], the tail of a per-slot sprite-entry fill, which hands each slot here while
 * its counter (B) still holds — "the straight placer" in that entry's role text. loc_307f runs
 * only on a patched image (grounding-debt.txt 0x307F), and 0x306A, the only other way in, follows
 * an unconditional `jp 0x309B` with nothing transferring to it, so no genuine run executes this.
 *
 * Parameters, all supplied by loc_307f: `entry` is the sprite entry the object occupies now,
 * `offsetPointer` points at the table byte that sets the offset, `coordinate` is the coordinate that
 * offset is added to, and `otherCoordinate` is stored unchanged; `record` is the record cursor, stepped on
 * with the entry cursor at the end.
 */

import { advanceToNextSlot } from "./advanceToNextSlot.js";

// Sprite entries are two bytes apart, and each entry's second coordinate sits 0x31 above its first
// (mechanisms.md: native Y at +0x31, native X at +0x00). The ROM writes (iy+0x33) and (iy+0x02),
// which is the NEXT entry's +0x31 and +0x00: 2 + 49 = 0x33.
const ENTRY_STRIDE = 2;
const SECOND_AXIS_OFFSET = 49;

export function placeTileAtTableSuppliedOffset(m, entry, offsetPointer, coordinate, otherCoordinate, record) {
  const { mem8 } = m;
  const nextEntry = entry + ENTRY_STRIDE;

  /* Place the new tile. `ld a,(hl) / add a,c` at 0x3074: the table byte under the caller's pointer
   * is added to C to give the displaced coordinate. `ld (iy+0x33),b` then stores B, unchanged,
   * into the next entry's second-axis slot, and `ld (iy+0x02),a` stores the displaced value into
   * its first-axis slot. The byte slot keeps only the low eight bits of the sum, as the Z80's
   * 8-bit add does, so the coordinate wraps at 256 like every sprite coordinate in the game. */
  const sum = mem8[offsetPointer] + coordinate;
  mem8[nextEntry + SECOND_AXIS_OFFSET] = otherCoordinate;
  mem8[nextEntry] = sum;

  /* Step on. The ROM ends with `jp 0x309b`, a tail jump into advanceToNextSlot [seen], which
   * moves the record cursor and the parallel sprite-entry cursor to the next object slot — so
   * the caller comes back already pointing at the entry this call just filled. */
  return advanceToNextSlot(m, record, entry);
}
