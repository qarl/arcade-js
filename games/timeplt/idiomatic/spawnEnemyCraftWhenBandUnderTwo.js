// SPDX-License-Identifier: GPL-3.0-only
/** spawnEnemyCraftWhenBandUnderTwo — gate a spawning tick on the packed-decimal life-tick byte the caller points at, count the
 * busy heads across the enemy-craft band, and only when fewer than two are busy run the free-slot
 * search: the cleared run when the owed-kills cell is zero, else the owed run seated for as many
 * turns as the round asks. LIVE-OUT: memory. The count and the two cursors go to the search as
 * arguments, and the sole caller (driveEnemyWaveForLifePhase) tail-returns this result. */
//
// ROM 0x379F-0x37D5; lift: translated/loc_379f.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. The ordinary enemy craft live in a band of seven sixteen-byte records starting at
// CRAFT_RECORD_SLOT0 (0xA850) [seen]. driveEnemyWaveForLifePhase runs the enemy-wave step of each life
// and picks its arm from the units digit of the middle place of the life's work counter; this is the arm for phase 8 (the
// caller's `phase < 9` test after the lower phases). It tops the band up only when it is nearly empty
// (fewer than two busy records), and only on the ticks its gate opens. The pointer the caller passes is LIFE_TICKS_LOW
// (0xAD05) [seen], the low packed-decimal digit pair of that counter (00..59), so the gate below opens
// twice per pass of that byte.
//
// Which search runs depends on KILLS_REMAINING (0xAD02) [seen], the manual's kill quota before the
// Mother-Ship appears: with nothing owed, loc_3793 seats the five-slot run; while kills are owed, the
// search runs from slot 6 (CRAFT_RECORD_SLOT6 / CRAFT_ENTRY_SLOT6) downward for CRAFT_SPAWN_SLOT_COUNT
// (0xACC1) [seen] turns.
//
// LIVE-OUT: memory -- whatever the free-slot search stages; nothing when the gate is shut or the band
// already has two busy records.

import { u16 } from "../../../core/int.js";
import { loc_3793 } from "./loc_3793.js";
import { spawnEnemyIntoFreeSlotElseStepSearch } from "./spawnEnemyIntoFreeSlotElseStepSearch.js";
import { CRAFT_ENTRY_SLOT6, CRAFT_RECORD_SLOT0, CRAFT_RECORD_SLOT6, KILLS_REMAINING, CRAFT_SPAWN_SLOT_COUNT } from "./names.js";

// Band geometry (`ld hl,0xa850 / ld de,0x0010 / ld bc,0x0700` at 0x37A6-0x37AC), the busy ceiling
// (`ld a,c / cp 0x02` at 0x37B8-0x37B9), and the second gate value (`cp 0x30` at 0x37A3).
const RECORD_STRIDE = 0x10;
const BAND_SLOTS = 0x07;
const BUSY_CEILING = 0x02;
const SECOND_OPEN_TICK = 0x30;

export function spawnEnemyCraftWhenBandUnderTwo(m, lifeTickCell = m.regs.hl) {
  const { mem8 } = m;

  // run only when the life-tick byte the caller points at reads zero or SECOND_OPEN_TICK
  const lifeTick = mem8[lifeTickCell];
  if (lifeTick !== 0x00 && lifeTick !== SECOND_OPEN_TICK) return;

  // count busy heads across the seven-record craft band (max 7, so the count never wraps)
  let busy = 0;
  let ptr = CRAFT_RECORD_SLOT0;
  for (let n = BAND_SLOTS; n > 0; n--) {
    if (mem8[ptr] !== 0x00) busy += 1;
    ptr = u16(ptr + RECORD_STRIDE);
  }
  if (busy >= BUSY_CEILING) return; // two or more slots already busy

  // nothing owed -> the cleared five-slot run; else the owed run over the craft spawn slot count
  if (mem8[KILLS_REMAINING] === 0x00) return loc_3793(m);

  // the owed run: the craft spawn slot count of turns, from the slot-6 record and its entry downward
  return spawnEnemyIntoFreeSlotElseStepSearch(m, CRAFT_RECORD_SLOT6, CRAFT_ENTRY_SLOT6, mem8[CRAFT_SPAWN_SLOT_COUNT]);
}
