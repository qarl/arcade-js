// SPDX-License-Identifier: GPL-3.0-only
/** stepSevenCraftSlots — work seven fixed object slots in one fixed order, each through the entry that seats
 * its own pair of cursors. The order is the whole of what this file decides; nothing here reads or
 * writes a slot itself. The last two stand down while the mother-ship cell is set.
 * LIVE-OUT: memory, and whatever the last slot worked leaves behind.
 *
 * ROM 0x28A1-0x28B6: seven `call`s in a row (0x28B7, 0x28C2, 0x28CD, 0x28D8, 0x28E3, 0x28EE, 0x28FE)
 * and a `ret`. [seen]
 *
 * Role in the machine: the enemy craft on screen live in a bank of object slots, each a record in work
 * RAM paired with a hardware sprite entry. This routine is the round-engine pass's sweep over seven of them. Each
 * callee is a tiny entry that loads the two cursors -- the slot's record and its sprite entry -- as
 * fixed immediates and then runs the era-keyed dispatch, so the per-slot behaviour depends on which
 * era (1910, 1940, ...) the round is in, not on anything decided here.
 *
 * ★ Seven is the size of the set, not the per-pass count. The sixth and seventh entries test
 * MOTHER_SHIP_ARMED and return at once while it is set, because (per names.js) the mother ship
 * occupies the last two of the seven ordinary craft slots. So on that arm only five slots step.
 * names.js notes the five-slot arm is qualified from the code rather than observed: on the recorded
 * tapes the cell read zero at every dispatch.
 */

import { seatCraftSlot0ThenDispatchByEra } from "./seatCraftSlot0ThenDispatchByEra.js";
import { seatCraftSlot1ThenDispatchByEra } from "./seatCraftSlot1ThenDispatchByEra.js";
import { seatCraftSlot2ThenDispatchByEra } from "./seatCraftSlot2ThenDispatchByEra.js";
import { seatCraftSlot3ThenDispatchByEra } from "./seatCraftSlot3ThenDispatchByEra.js";
import { seatCraftSlot4ThenDispatchByEra } from "./seatCraftSlot4ThenDispatchByEra.js";
import { seatMotherShipSlotThenDispatchByEraUnlessArmed } from "./seatMotherShipSlotThenDispatchByEraUnlessArmed.js";
import { seatCraftSlot6ThenDispatchByEraUnlessArmed } from "./seatCraftSlot6ThenDispatchByEraUnlessArmed.js";

// The seven entries in the ROM's call order. Order matters: a later slot sees any cell an earlier
// slot's service wrote this pass, exactly as on the real machine.
const CHAIN = [
  seatCraftSlot0ThenDispatchByEra,
  seatCraftSlot1ThenDispatchByEra,
  seatCraftSlot2ThenDispatchByEra,
  seatCraftSlot3ThenDispatchByEra,
  seatCraftSlot4ThenDispatchByEra,
  // The two gated entries: each returns at once while MOTHER_SHIP_ARMED is set.
  seatMotherShipSlotThenDispatchByEraUnlessArmed,
  seatCraftSlot6ThenDispatchByEraUnlessArmed,
];

export function stepSevenCraftSlots(m) {
  // Work each slot in turn; nothing is carried from one call to the next except memory.
  for (const workSlot of CHAIN) workSlot(m);
}
