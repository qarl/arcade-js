// SPDX-License-Identifier: GPL-3.0-only
/** seatCraftSlot2ThenDispatchByEra — hand slot 2's craft record + entry cursors to the era arm. LIVE-OUT: memory.
 *
 * WHAT IT IS: one of the seven small per-slot entries of the enemy-craft band. Time Pilot keeps its
 * enemy craft in a band of seven object records at 0xA850 (stride 0x10), each paired in lockstep with
 * a sprite entry at 0xAA1A (stride 0x02); once armed, the Mother-Ship holds slots 5 and 6. This entry
 * services slot 2: record CRAFT_RECORD_SLOT2 (0xA870) with sprite entry CRAFT_ENTRY_SLOT2 (0xAA1E).
 *
 * ROLE IN THE MACHINE: stepSevenCraftSlots (0x28A1) is nothing but an order -- it runs slots 0-4, then
 * the Mother-Ship slot, then slot 6, each through its own seat-and-dispatch entry like this one
 * (mechanisms.md). The only thing that distinguishes this entry from its unconditional siblings is the
 * pair of addresses it seats (names.js).
 *
 * ROM: 0x28CD (0x28CD-0x28D7), frozen lift translated/loc_28cd.js. Grounding tag: [seen]
 * (names.js). The ROM loads IX = 0xA870 and IY = 0xAA1E and jumps into the era dispatcher at 0x290E.
 *
 * LIVE-OUT: memory only -- whatever the selected era handler writes into this slot's record and
 * sprite entry. Nothing is returned beyond what the dispatcher returns.
 */

import { dispatchSeatedSlotByEraIndex } from "./dispatchSeatedSlotByEraIndex.js";
import { CRAFT_ENTRY_SLOT2, CRAFT_RECORD_SLOT2 } from "./names.js";


export function seatCraftSlot2ThenDispatchByEra(m) {
  /*
   * Seat and dispatch. In the ROM this is `ld ix,0xA870` / `ld iy,0xAA1E` then a jump to 0x290E,
   * which reads ERA_INDEX (0xAD04), keeps its low three bits and indexes the inline word table
   * ERA_SLOT_DISPATCH_TABLE (0x2914) to pick the slot handler (serviceEra0..4EnemyCraftSlot for eras 0-4).
   * Here the record and sprite entry travel as arguments instead of in IX/IY. The handler is reached
   * as a transfer, so its result is this entry's result and nothing here runs after it.
   */
  return dispatchSeatedSlotByEraIndex(m, CRAFT_RECORD_SLOT2, CRAFT_ENTRY_SLOT2);
}
