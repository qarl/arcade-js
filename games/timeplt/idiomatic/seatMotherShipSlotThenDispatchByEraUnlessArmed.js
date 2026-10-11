// SPDX-License-Identifier: GPL-3.0-only
/** seatMotherShipSlotThenDispatchByEraUnlessArmed — put one object record, and the sprite entry that shows it, in front of the era-keyed
 * per-slot handler, unless the Mother-Ship is up: while it is nothing here runs at all. The handler
 * is reached as a transfer, so it returns past here and nothing here runs after it.
 * LIVE-OUT: memory, and whatever the handler leaves behind.
 *
 * WHAT IT IS: the per-slot entry for slot 5 of the seven-slot enemy-craft band (records at 0xA850,
 * stride 0x10, paired with sprite entries at 0xAA1A, stride 0x02). Slot 5 is the Mother-Ship's slot:
 * record MOTHER_SHIP_STATE (0xA8A0) with sprite entry MOTHER_SHIP_ENTRY (0xAA24).
 *
 * ROLE IN THE MACHINE: stepSevenCraftSlots (0x28A1) runs slots 0-4, then this entry, then slot 6
 * (mechanisms.md). Before the boss arrives this record is just one more craft slot and gets the
 * ordinary era handler like the others. Once armed, the Mother-Ship occupies this record AND slot 6's
 * and is driven by armMotherShipOrStep instead, so this entry and its twin
 * seatCraftSlot6ThenDispatchByEraUnlessArmed return at once while MOTHER_SHIP_ARMED is set.
 *
 * ROM: 0x28EE (0x28EE-0x28FD), frozen lift translated/loc_28ee.js. Grounding tag: [seen] (names.js).
 */

import { dispatchSeatedSlotByEraIndex } from "./dispatchSeatedSlotByEraIndex.js";
import { MOTHER_SHIP_ARMED, MOTHER_SHIP_ENTRY, MOTHER_SHIP_STATE } from "./names.js";


export function seatMotherShipSlotThenDispatchByEraUnlessArmed(m) {
  /*
   * Step 1 -- the armed gate. ROM `ld a,(0xad0d)` / `and a` / `ret nz`: MOTHER_SHIP_ARMED (0xAD0D)
   * is all-ones or zero. While it is up the slot is left unserviced on that pass. The flag is not
   * "the boss is on screen": it stays up after the boss is destroyed, until startNextRound or the
   * life-start playfield reset clears it (names.js).
   */
  if (m.mem8[MOTHER_SHIP_ARMED] !== 0) return;
  /*
   * Step 2 -- seat and dispatch. ROM `ld ix,0xa8a0` / `ld iy,0xaa24` then a jump to 0x290E, which
   * keys on the low three bits of ERA_INDEX (0xAD04) through the inline word table at 0x2914 to pick
   * the slot handler for the current era. The record and sprite entry travel as arguments instead of
   * in IX/IY.
   */
  return dispatchSeatedSlotByEraIndex(m, MOTHER_SHIP_STATE, MOTHER_SHIP_ENTRY);
}
