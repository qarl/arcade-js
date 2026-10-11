// SPDX-License-Identifier: GPL-3.0-only
/** stepFourActorSlots — run the same per-slot step over four slots in turn.
 *
 * For each slot the ROM loads the record and sprite-entry pointers into IX and IY and calls the
 * step; here the pair is handed to the step, dispatchObjectSlotByHeadByte, as its arguments. The ROM
 * leaves the fourth pair in its index registers, but nothing after this reads them.
 * LIVE-OUT: memory.
 * ROM 0x3E36-0x3E62. Grounding: [seen] (names.js ROUTINES 0x3E36). */

import { dispatchObjectSlotByHeadByte } from "./dispatchObjectSlotByHeadByte.js";
import { ACTOR_ENTRY_SLOT0, ACTOR_ENTRY_SLOT1, ACTOR_ENTRY_SLOT2, ACTOR_ENTRY_SLOT3, ACTOR_RECORD_SLOT0, ACTOR_RECORD_SLOT1, ACTOR_RECORD_SLOT2, ACTOR_RECORD_SLOT3 } from "./names.js";

// [record, sprite entry] for each slot, in the ROM's order: the records sit sixteen bytes apart
// from 0xA810 and the sprite entries two bytes apart from 0xAA12.
const SLOTS = [
  [ACTOR_RECORD_SLOT0, ACTOR_ENTRY_SLOT0],
  [ACTOR_RECORD_SLOT1, ACTOR_ENTRY_SLOT1],
  [ACTOR_RECORD_SLOT2, ACTOR_ENTRY_SLOT2],
  [ACTOR_RECORD_SLOT3, ACTOR_ENTRY_SLOT3],
];

export function stepFourActorSlots(m) {
  for (const [record, entry] of SLOTS) {
    // ROM per slot: `ld ix,record / ld iy,entry / call 0x3e63`.
    dispatchObjectSlotByHeadByte(m, record, entry);
  }
}
