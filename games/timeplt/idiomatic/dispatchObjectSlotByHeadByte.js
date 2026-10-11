// SPDX-License-Identifier: GPL-3.0-only
/** dispatchObjectSlotByHeadByte — split three ways on the head byte of the record the index register points at. Zero
 * is an exit with nothing done; all-ones and every other non-zero value each hand over to their
 * own continuation. That split is the whole of the routine: one byte read, nothing written, and
 * neither continuation is given anything this entry computed. LIVE-OUT: whatever it hands over to.
 *
 * ROM 0x3E63-0x3E6B (frozen lift translated/loc_3e63.js). Grounding: [seen] in names.js.
 *
 * Role in the machine: a per-slot handler in an object sweep. An object record's head byte is its
 * state (names.js, the enemy-craft slot note: 0x00 free, 0xFF live, other values a count), so the
 * split is: free slot -> nothing to do; live -> fly it (flyAndRetireSlotCyclingShapeInEra4, 0x3E6C,
 * which the ROM simply falls into); any other value -> the slot is running a count
 * (runSlotCountdownDriftAndAnimateElseRetire, 0x3E8E, a tail jump).
 *
 * Parameters: `record` the object's record and `entry` its sprite entry, as the sweep seats them; both are
 * passed through untouched. */

import { flyAndRetireSlotCyclingShapeInEra4 } from "./flyAndRetireSlotCyclingShapeInEra4.js";
import { runSlotCountdownDriftAndAnimateElseRetire } from "./runSlotCountdownDriftAndAnimateElseRetire.js";

// The live marker. The ROM tests it with `inc a`, which gives zero only when the byte was 0xFF.
const ALL_ONES = 255;

export function dispatchObjectSlotByHeadByte(m, record = m.regs.ix, entry = m.regs.iy) {
  const head = m.mem8[record];
  // `ld a,(ix+0x00) / and a / ret z`: a free slot returns at once.
  if (head === 0) return;
  // 0xFF falls through into 0x3E6C; anything else jumps to 0x3E8E.
  return head === ALL_ONES
    ? flyAndRetireSlotCyclingShapeInEra4(m, record, entry)
    : runSlotCountdownDriftAndAnimateElseRetire(m, record, entry);
}
