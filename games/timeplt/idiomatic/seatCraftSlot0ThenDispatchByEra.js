// SPDX-License-Identifier: GPL-3.0-only
/** seatCraftSlot0ThenDispatchByEra — hand slot 0's craft record + entry cursors to the era arm. LIVE-OUT: memory. */

/*
 * ROM 0x28B7-0x28C1, grounding [seen] (names.js ROUTINES 0x28b7).
 *
 * WHAT IT IS. The enemy craft live in a band of seven 16-byte records starting at CRAFT_RECORD_SLOT0
 * (0xA850, [seen]), each with a two-byte sprite entry starting at CRAFT_ENTRY_SLOT0 (0xAA1A, [seen]).
 * Each pass the round engine services the band slot by slot through a family of tiny entries --
 * seatCraftSlot0..4ThenDispatchByEra, plus two more (seatMotherShipSlotThenDispatchByEraUnlessArmed,
 * seatCraftSlot6ThenDispatchByEraUnlessArmed) gated on the mother ship's armed cell -- and this is the
 * slot-0 member. Its pair of fixed addresses is the whole of what tells it apart from slots 1-4.
 *
 * ROLE. Point the per-slot machinery at slot 0, then let dispatchSeatedSlotByEraIndex (0x290E) pick
 * the handler for the current era (the craft fly differently in each era) and run it on this slot.
 *
 * LIVE-OUT: memory only -- whatever the era handler writes into slot 0's record and sprite entry.
 */

import { dispatchSeatedSlotByEraIndex } from "./dispatchSeatedSlotByEraIndex.js";
import { CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0 } from "./names.js";


// In the ROM, `ld ix,0xa850 / ld iy,0xaa1a` seats the record and sprite-entry cursors and then
// `jp 0x290e` transfers to the era dispatch; here the two cursors are passed as arguments, and the
// dispatch's result is handed straight back, as the tail jump would.
export function seatCraftSlot0ThenDispatchByEra(m) {
  return dispatchSeatedSlotByEraIndex(m, CRAFT_RECORD_SLOT0, CRAFT_ENTRY_SLOT0);
}
