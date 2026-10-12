// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroySlotsAndPlayerOnContact — ROM 0x5152 [seen]
 *
 * WHAT IT IS. A contact sweep that runs the player's own ship against a run of object slots,
 * destroying the player along with whatever it touches. Per names.js a MAME write tap caught this routine storing the destroyed
 * marker into PLAYER_STATE (0xA800) during a driven game -- the shots-against-targets sweeps never
 * touch the player's state.
 *
 * ROLE. Run the player against a run of slots and, for each one that overlaps, mark BOTH as hit
 * and post the score for it. The sweep does not stop at the first, and the player's own mark is
 * re-stamped each time, so one pass can take several slots. It is refused outright unless the
 * player is still whole, and a slot is skipped unless it is whole too. Overlap is two windows on
 * two axes: the caller supplies the bias and the width for one, the other is fixed at eight either
 * side. A run of zero slots means a full two hundred and fifty-six.
 *
 * PARAMETERS: records = the first slot's record (its state byte; DE in the ROM); entries = the
 * first slot's sprite entry (IY); slots = how many slots to sweep (B); bias and width = the
 * first-axis window (L and H). Its callers (runAllCollisionSweepsThisFrame,
 * splitCollisionWorkByFrameParity) pass bias 7 and width 15, a first-axis reach of 7 either side.
 *
 * LIVE-OUT: memory, plus the two cursors (record in E, entry in IY). They are handed back one past
 * the last slot (the record cursor steps its low half only, the entry cursor whole) for a caller
 * that tail-runs another sweep on the same run of slots; on the early refusal neither moves.
 *
 * RETURN VALUE: the same cursor pair as { record, entry } (each u16-wrapped), so a caller that runs
 * another sweep next can continue from it without reading the registers back. The register writes
 * are unchanged and remain the declared behaviour; on the early refusal neither register is
 * written and the pair echoes the un-advanced input cursors.
 */

import { u8, u16 } from "../../../core/int.js";
import { postChainedHitScore } from "./postChainedHitScore.js";
import { PLAYER_ENTRY, PLAYER_SPRITE_Y, PLAYER_STATE } from "./names.js";


// The slot alphabet: 0xFF live ("whole"), 0xF0 just hit (for the player, the start of the death).
const WHOLE = 0xff;
const HIT = 0xf0;

// Sprite-entry offsets compared: +0 and +0x31 (the sprite Y). The second-axis window is fixed:
// (player - slot + 8) mod 256 < 17, a difference of -8..+8 (ROM: add a,0x08 / cp 0x11).
const FIRST_COORDINATE = 0x00;
const SECOND_COORDINATE = 0x31;
const SECOND_BIAS = 8;
const SECOND_WIDTH = 17;

// Slot records are 16 bytes apart; their sprite entries 2 bytes apart.
const RECORD_STRIDE = 16;
const ENTRY_STRIDE = 2;

export function destroySlotsAndPlayerOnContact(m, records = m.regs.de, entries = m.regs.iy, slots = m.regs.b, bias = m.regs.l, width = m.regs.h) {
  const { mem8 } = m;
  // Early refusal: neither cursor moves (declared behaviour); the tuple echoes the seated inputs.
  // The player must still be whole; this is tested once, before the sweep (ROM 0x5152: ld a,(0xa800)
  // / inc a / ret nz), so a player hit by an earlier slot keeps being tested against the rest.
  if (mem8[PLAYER_STATE] !== WHOLE) return { record: u16(records), entry: u16(entries) };

  let record = records;
  let entry = entries;
  let left = slots;
  do {
    // The player's position (PLAYER_ENTRY 0xAA10 and PLAYER_SPRITE_Y 0xAA41) relative to this
    // slot's sprite entry, on both axes.
    const nativeXDelta = u8(mem8[PLAYER_ENTRY] - mem8[u16(entry + FIRST_COORDINATE)]);
    const nativeYDelta = u8(mem8[PLAYER_SPRITE_Y] - mem8[u16(entry + SECOND_COORDINATE)]);
    // A whole slot inside both windows is a contact.
    if (
      mem8[record] === WHOLE &&
      u8(nativeXDelta + bias) < width &&
      u8(nativeYDelta + SECOND_BIAS) < SECOND_WIDTH
    ) {
      // Mark the player and the slot hit, and post the score (postChainedHitScore 0x51DE).
      mem8[PLAYER_STATE] = HIT;
      mem8[record] = HIT;
      postChainedHitScore(m);
    }
    // Step both cursors to the next slot: the record by 16 within its page (only the low byte is
    // added to), the sprite entry by 2 as a full address. The count is a byte, so starting at 0
    // runs 256 slots.
    record = (record - (record & 0xff)) | u8(record + RECORD_STRIDE);
    entry = u16(entry + ENTRY_STRIDE);
    left = u8(left - 1);
  } while (left !== 0);

  // Hand the threaded cursors back (E only, D untouched; IY whole) folded into the return, keeping the
  // declared live-out writes without a bare register statement (assignment yields its RHS pre-mask).
  return { record: u16(m.regs.e = record), entry: u16(m.regs.iy = entry) };
}
