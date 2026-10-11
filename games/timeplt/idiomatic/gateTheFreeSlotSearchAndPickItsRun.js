// SPDX-License-Identifier: GPL-3.0-only
/** gateTheFreeSlotSearchAndPickItsRun — only two counter values open the gate; past it, the count of
 * enemies still owed picks between two runs of the slot file (the owed run for the craft spawn slot count,
 * else a fixed run of five two records earlier), and hands the run's two cursors and its count to the
 * search. LIVE-OUT: memory. */
//
// ROM 0x37BD-0x37D5, plus the 0x3793-0x379E block its cleared arm branches back to (lift:
// translated/loc_37bd.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This is the enemy-craft spawner's "is it time, and where?" step. names.js
// records driveEnemyWaveForLifePhase (0x36AF) sending life phases below 7 here, with HL pointing at
// LIFE_TICKS_LOW (0xAD05), a packed-decimal counter. It decides whether this tick spawns at all and,
// if so, which run of object slots the free-slot search walks; the search itself fills at most one
// free slot and does not come back here.
//
// PARAMETER. `gateCell` is the address of the gate byte, as the caller points at it. The routine reads the
// byte through the pointer, so it does not itself know which cell it is.
//
// LIVE-OUT: memory only -- whatever slot the search fills. Nothing is staged when the gate is shut.

import { CRAFT_ENTRY_SLOT4, CRAFT_ENTRY_SLOT6, CRAFT_RECORD_SLOT4, CRAFT_RECORD_SLOT6, KILLS_REMAINING, CRAFT_SPAWN_SLOT_COUNT } from "./names.js";
import { spawnEnemyIntoFreeSlotElseStepSearch } from "./spawnEnemyIntoFreeSlotElseStepSearch.js";

// The two gate values (`and a` then `cp 0x30`, `ret nz` at 0x37C3). The counter is packed decimal,
// so 0x00 and 0x30 are two fixed moments of its cycle rather than two arbitrary bytes.
const LAUNCH_TICKS = [0x00, 0x30];

// The two runs of the one slot file; the search walks each DOWNWARD from its seat.
//   OWED    -- seated on slot 6 (record 0xA8B0, sprite entry 0xAA26), length = the craft spawn slot count
//              (0x37CA-0x37D5).
//   CLEARED -- seated on slot 4 (record 0xA890, sprite entry 0xAA22), a fixed five (the 0x3793 block).
const OWED_RUN = { records: CRAFT_RECORD_SLOT6, entries: CRAFT_ENTRY_SLOT6 };
const CLEARED_RUN = { records: CRAFT_RECORD_SLOT4, entries: CRAFT_ENTRY_SLOT4, slots: 5 };

export function gateTheFreeSlotSearchAndPickItsRun(m, gateCell = m.regs.hl) {
  const { mem8 } = m;
  // THE GATE. Spawn only on the two counter values; every other tick ends here with nothing staged,
  // so at most two moments of each counter cycle can launch a craft.
  if (!LAUNCH_TICKS.includes(mem8[gateCell])) return;

  // PICK THE RUN. KILLS_REMAINING (0xAD02, [seen]) counts down the enemies still to destroy before the
  // Mother-Ship appears. While any are owed, search the owed run for as many slots as
  // CRAFT_SPAWN_SLOT_COUNT (0xACC1, [seen]) asks; once none are owed, search the fixed run of five instead
  // (the ROM's `jr z,0x3793` at 0x37C8). The same quota-picks-the-count rule appears again at 0x3702.
  const cleared = mem8[KILLS_REMAINING] === 0;
  const run = cleared ? CLEARED_RUN : OWED_RUN;
  const slotCount = cleared ? CLEARED_RUN.slots : mem8[CRAFT_SPAWN_SLOT_COUNT];
  // HAND OFF (tail into 0x37D6). The search takes the record cursor (the ROM's IX), the sprite-entry
  // cursor (IY) and the turn count (B), and claims the first free slot it meets.
  return spawnEnemyIntoFreeSlotElseStepSearch(m, run.records, run.entries, slotCount);
}
