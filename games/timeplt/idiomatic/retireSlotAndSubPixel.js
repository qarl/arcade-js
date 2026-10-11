// SPDX-License-Identifier: GPL-3.0-only
/**
 * retireSlotAndSubPixel — take an object out of play, zeroing each coordinate WHOLE: occupancy byte,
 * both sub-pixel remainders, and both sprite-entry coordinates.
 *
 * WHAT IT IS: ROM routine 0x2BDE [seen]. Five unconditional zero stores and no reads: the slot byte
 * that marks the object occupied, the two sub-pixel remainders carrying the fractional part of its
 * motion, and both coordinates of its sprite entry.
 *
 * ROLE IN THE MACHINE: one of the two retire helpers that leave the delay at +0x0E alone. Its sibling retireSlot leaves the
 * sub-pixel remainders standing; this one clears them too. No file calls both, and spawn paths differ
 * on whether they reinitialise those cells, so which helper retired a slot can still be visible to its
 * next occupant.
 *
 * PARAMETERS: `slot` is the object's state record (the ROM passes it in IX), `sprite` its sprite entry
 * (IY). LIVE-OUT: memory only -- the five bytes written.
 */

/** Record offset of the row-axis sub-pixel remainder. */
const ROW_REMAINDER = 3;
/** Record offset of the column-axis sub-pixel remainder. */
const COLUMN_REMAINDER = 5;
/** A sprite entry's two coordinates sit this far apart, in parallel tables. */
const SPRITE_ROW = 49;

export function retireSlotAndSubPixel(m, slot = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  // Step 1: release the slot -- a zero occupancy byte is what the per-slot handlers read as "empty".
  mem8[slot] = 0;
  // Step 2: clear the fractional motion carried in the record, so no leftover sub-pixel step is
  // inherited by whatever object is spawned into this slot next.
  mem8[slot + ROW_REMAINDER] = 0;
  mem8[slot + COLUMN_REMAINDER] = 0;
  // Step 3: take the sprite off the screen by zeroing both of its coordinates.
  mem8[sprite] = 0;
  mem8[sprite + SPRITE_ROW] = 0;
}
