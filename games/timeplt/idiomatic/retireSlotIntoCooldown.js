// SPDX-License-Identifier: GPL-3.0-only
/**
 * retireSlotIntoCooldown — take an object out of play, then arm the record's delay byte instead of
 * leaving it clear, so the slot is held rather than freed.
 *
 * WHAT IT IS: ROM routine 0x48AD [seen]. The record's occupancy byte and both of the sprite entry's
 * coordinate bytes go to zero -- which is retireSlot's body byte for byte, and the whole of taking the
 * object out of play -- and then record offset 14 is loaded with 0xF0.
 *
 * ROLE IN THE MACHINE: that offset-14 byte is a cooldown, not scratch. Every caller retires the
 * parachutist record 0xA8F0, whose handler sends the emptied slot to spawnAtEdgeAhead, and that
 * routine counts this byte down and places the slot again only when it reaches zero. So the slot is
 * not free the instant it is emptied. The arming is the entire
 * difference from retireSlot. retireObjectAndHold arms the same byte with 0x80 and
 * retireEntryPairIntoCooldown with 95; how long any of these lasts depends on the countdown's tick rate,
 * which nothing here fixes. Both bases are parameters, so WHICH slot goes out is the caller's.
 *
 * PARAMETERS: `record` is the object's state record (the ROM passes it in IX), `entry` its sprite entry
 * (IY). LIVE-OUT: memory only -- four bytes.
 */

/** Record offset 0: the occupancy byte; zero means the slot is empty. */
const OCCUPANCY = 0;
/** Record offset 14: the delay byte counted down before the slot is reused. */
const DELAY = 0x0e;
/** A sprite entry's two coordinates live in parallel tables forty-nine (0x31) bytes apart. */
const SECOND_AXIS_OFFSET = 0x31;
/** The delay armed here. */
const DELAY_FRAMES = 0xf0;

export function retireSlotIntoCooldown(m, record = m.regs.ix, entry = m.regs.iy) {
  const { mem8 } = m;
  // Step 1: release the slot and take its sprite off the screen -- occupancy byte, then both
  // coordinates (ROM `ld (ix+0x00),0` / `ld (iy+0x00),0` / `ld (iy+0x31),0`).
  mem8[record + OCCUPANCY] = 0;
  mem8[entry] = 0;
  mem8[entry + SECOND_AXIS_OFFSET] = 0;
  // Step 2: arm the cooldown, so the per-slot handler counts the slot down before anything may spawn
  // into it again (ROM `ld (ix+0x0e),0xf0`).
  mem8[record + DELAY] = DELAY_FRAMES;
}
