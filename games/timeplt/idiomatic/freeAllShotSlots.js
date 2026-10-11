// SPDX-License-Identifier: GPL-3.0-only
/** freeAllShotSlots — clear the six-slot shot record array, zeroing each slot's first and fifth bytes. Fill byte
 * and slot stride are read from program space (on this image fill=0, stride=16). LIVE-OUT: memory + the record cursor past the last slot.
 *
 * ROM 0x2755-0x2770 (lift: translated/loc_2755.js). Grounding: [seen].
 *
 * Role in the machine: the player's shots live in their own six-record array at PLAYER_SHOT_ARRAY
 * (0xAA80, 16-byte records, no sprite entries). Freeing them belongs to the start of a life: the
 * only caller is the life-start routine resetPlayfieldForLifeStart, and under MAME the store fired
 * exactly as often as the life-start store wrote the player alive. Each record's +0 is its
 * occupancy byte; +4 is a byte of its position (see the shot-array note in names.js). No other
 * byte of a record is touched.
 *
 * Patch-sensitive by construction: neither the fill nor the stride is an immediate in the code,
 * both are fetched from bytes elsewhere in the program image, so changing either byte would make
 * this clear a different pattern at a different stride.
 */

import { u16 } from "../../../core/int.js";
import { PLAYER_SHOT_ARRAY, PLAYER_SHOT_SLOT_STRIDE, SHOT_SLOT_FILL_BYTE } from "./names.js";

// Six shot records (`ld b,0x06`); in each, +0 and +4 are cleared (`ld (ix+0x00),a / ld (ix+0x04),a`).
const SLOTS = 6;
const SECOND_CLEARED_BYTE = 4;

// Two program-space bytes: the fill (also the stride's high half) and the stride's low half.
export function freeAllShotSlots(m) {
  const { mem8 } = m;
  // ROM: `ld a,(0x0861) / ld e,a / ld a,(0x5c01) / ld d,a` — DE becomes the stride, and A, still
  // holding the 0x5C01 byte, is what gets stored. One byte doing double duty is why the fill and
  // the stride's high half are the same value.
  const fill = mem8[SHOT_SLOT_FILL_BYTE];
  const stride = mem8[PLAYER_SHOT_SLOT_STRIDE] | (fill << 8);

  // Walk the six records from the array base, clearing +0 and +4 and stepping on by the stride
  // (`add ix,de`), with 16-bit wrap.
  let slot = PLAYER_SHOT_ARRAY;
  for (let i = 0; i < SLOTS; i++) {
    mem8[slot] = fill;
    mem8[u16(slot + SECOND_CLEARED_BYTE)] = fill;
    slot = u16(slot + stride);
  }
  // The record cursor ends one stride past the last record (the ROM's IX); handed back as well.
  return (m.regs.ix = slot);
}
