// SPDX-License-Identifier: GPL-3.0-only
/**
 * retireObjectAndHold — take an object and the slot one stride on out of play, then hold the caller's
 * slot on a delay rather than release it.
 *
 * WHAT IT IS: ROM routine 0x3C0D [seen]. Six bytes go to zero: the head (occupancy) byte of the record
 * the caller points at AND of the record one stride on, both coordinates of the sprite entry the caller
 * points at, and both coordinates of one FIXED entry, ERA_OBJECT_ENTRY_SLOT1, that no argument selects.
 * A seventh byte of the caller's record, offset 14, is then set to 128 instead of being cleared.
 *
 * ROLE IN THE MACHINE: "hold" means the byte left standing is a delay, not a survivor of the wipe. It
 * was watched: the record head went to zero and that byte jumped to 128 in the same frame, then counted
 * down by one every OTHER frame -- the cadence of the routine at 0x3C25, which gates its decrement on
 * FRAME_TICK's low bit and branches only when the byte reaches zero. Its siblings retireSlot and
 * retireSlotAndSubPixel clear their record and stop; this one retires a second record and a fixed entry
 * as well, and arms the delay.
 *
 * PARAMETERS: `record` is the object's state record (the ROM passes it in IX), `entry` its sprite entry
 * (IY). LIVE-OUT: memory only -- those seven bytes.
 */

import { ERA_OBJECT_ENTRY_SLOT1 } from "./names.js";
/** Object records are sixteen bytes long, so the next record starts 0x10 on. */
const RECORD_STRIDE = 16;
/** A sprite entry's two coordinates live in parallel tables forty-nine (0x31) bytes apart. */
const SECOND_AXIS_OFFSET = 49;
/** Record offset 14: the delay byte counted down on passes that find FRAME_TICK even. */
const HELD_BYTE = 14;
/** The delay armed here (0x80): 128 decrements before 0x3C25 sees zero. */
const HELD_AT = 128;

export function retireObjectAndHold(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;
  // Step 1: empty this record and the record one stride on -- a zero head byte is what the per-slot
  // handlers read as a free slot.
  mem8[record] = 0;
  mem8[record + RECORD_STRIDE] = 0;
  // Step 2: take the caller's sprite off the screen by zeroing both of its coordinates.
  mem8[entry] = 0;
  mem8[entry + SECOND_AXIS_OFFSET] = 0;
  // Step 3: do the same for the one fixed entry, second coordinate first -- the order the ROM stores
  // them in (`ld (0xaa5b),a` then `ld (0xaa2a),a`).
  mem8[ERA_OBJECT_ENTRY_SLOT1 + SECOND_AXIS_OFFSET] = 0;
  mem8[ERA_OBJECT_ENTRY_SLOT1] = 0;
  // Step 4: arm the delay byte with a non-zero count instead of clearing it, so the slot is held off
  // for its countdown rather than free for the next spawn at once (ROM `ld (ix+0x0e),0x80`).
  mem8[record + HELD_BYTE] = HELD_AT;
}
