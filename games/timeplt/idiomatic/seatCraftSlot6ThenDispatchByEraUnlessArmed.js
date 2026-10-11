// SPDX-License-Identifier: GPL-3.0-only
/** seatCraftSlot6ThenDispatchByEraUnlessArmed — unless the Mother-Ship is up, hand slot 6's craft record + entry cursors to the era arm. LIVE-OUT: memory.
 *
 * WHAT IT IS: the last of the seven small per-slot entries of the enemy-craft band. Time Pilot keeps
 * its enemy craft in a band of seven object records at 0xA850 (stride 0x10), each paired in lockstep
 * with a sprite entry at 0xAA1A (stride 0x02); slot 5 is the Mother-Ship. This entry services slot 6:
 * record CRAFT_RECORD_SLOT6 (0xA8B0) with sprite entry CRAFT_ENTRY_SLOT6 (0xAA26).
 *
 * ROLE IN THE MACHINE: stepSevenCraftSlots (0x28A1) runs slots 0-4, then the Mother-Ship slot, then
 * this one (mechanisms.md). Slot 6 has a second duty: once the Mother-Ship is armed it occupies TWO
 * consecutive records -- its own (MOTHER_SHIP_STATE, 0xA8A0) and slot 6's -- and from then on it is
 * driven by armMotherShipOrStep, not by the ordinary craft handler. So this entry stands down while
 * MOTHER_SHIP_ARMED is set, exactly like its twin seatMotherShipSlotThenDispatchByEraUnlessArmed.
 *
 * ROM: 0x28FE (0x28FE-0x290D), frozen lift translated/loc_28fe.js. Grounding tag: [seen] (names.js).
 *
 * LIVE-OUT: memory only -- whatever the selected era handler writes into slot 6's record and sprite
 * entry; nothing at all when the gate is closed.
 */

import { dispatchSeatedSlotByEraIndex } from "./dispatchSeatedSlotByEraIndex.js";
import { CRAFT_ENTRY_SLOT6, CRAFT_RECORD_SLOT6, MOTHER_SHIP_ARMED } from "./names.js";


export function seatCraftSlot6ThenDispatchByEraUnlessArmed(m) {
  /*
   * Step 1 -- the Mother-Ship gate. ROM `ld a,(0xad0d)` / `and a` / `ret nz`: MOTHER_SHIP_ARMED
   * (0xAD0D) is all-ones or zero. Non-zero means slot 6's record is the boss's second record, so the
   * slot is left unserviced this pass. Note the flag stays up after the boss is destroyed, until
   * startNextRound or the life-start playfield reset clears it (names.js), so the slot stays out of
   * the sweep for the rest of that round or life.
   */
  if (m.mem8[MOTHER_SHIP_ARMED] !== 0) return;
  /*
   * Step 2 -- seat and dispatch. ROM `ld ix,0xa8b0` / `ld iy,0xaa26` then a jump to 0x290E, which
   * keys on the low three bits of ERA_INDEX (0xAD04) through the inline word table at 0x2914 to pick
   * the slot handler for the current era. The record and sprite entry travel as arguments instead of
   * in IX/IY; the handler is reached as a transfer, so nothing here runs after it.
   */
  return dispatchSeatedSlotByEraIndex(m, CRAFT_RECORD_SLOT6, CRAFT_ENTRY_SLOT6);
}
