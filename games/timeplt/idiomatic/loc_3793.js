// SPDX-License-Identifier: GPL-3.0-only
/** loc_3793 — start the free-slot search on the highest of five consecutive object slots, handing
 * the body that fills the first free one a count of five and the two cursors; all three are
 * constants. LIVE-OUT: memory. */
//
// ROM 0x3793-0x379E (lift: translated/loc_3793.js). Grounding tag in names.js ROUTINES: [seen].
// The name is kept as hex on purpose: names.js records that no absolute reference to 0x3793 exists
// anywhere in the ROM image -- the only way in is a relative `jr z` at 0x37C8, interior to another
// routine's body -- so this is a stretch of that routine's job, not a routine with a job of its own.
//
// ROLE IN THE MACHINE. It is the "no kills owed" arm of the enemy-craft spawner. Once KILLS_REMAINING
// reaches zero the spawner stops sizing its search by the craft spawn slot count and instead walks a fixed
// run of five slots. names.js records spawnEnemyCraftWhenBandUnderTwo (0x379F) transferring here when
// KILLS_REMAINING is zero; gateTheFreeSlotSearchAndPickItsRun (0x37BD) reaches the same `jr z,0x3793` at 0x37C8 and stages only the other arm, the owed-kills run, inline at 0x37CA.
//
// It reads nothing and writes nothing itself: all three values are constants chosen here, and control
// does not come back. LIVE-OUT: memory only -- whatever slot the search fills.

import { spawnEnemyIntoFreeSlotElseStepSearch } from "./spawnEnemyIntoFreeSlotElseStepSearch.js";
import { CRAFT_ENTRY_SLOT4, CRAFT_RECORD_SLOT4 } from "./names.js";

// The run's length, the search's turn count (the ROM's B): `ld b,0x05` at 0x3793.
const SLOTS_IN_THE_PASS = 5;

export function loc_3793(m) {
  // Seat the record cursor on CRAFT_RECORD_SLOT4 (0xA890, the ROM's IX) and the sprite-entry cursor on
  // CRAFT_ENTRY_SLOT4 (0xAA22, IY) -- both [seen] -- then transfer to the search body at 0x37D6
  // (`jr 0x37d6`), which claims the first free slot in the run.
  return spawnEnemyIntoFreeSlotElseStepSearch(m, CRAFT_RECORD_SLOT4, CRAFT_ENTRY_SLOT4, SLOTS_IN_THE_PASS);
}
