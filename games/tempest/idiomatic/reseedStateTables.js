// SPDX-License-Identifier: GPL-3.0-only
import { u8, u16 } from "../../../core/int.js";
import {
  loc_9f, loc_2b, COORD_LIST_PTR_LO, COORD_LIST_PTR_HI, SLOT_LOOP_INDEX, TABLE_CURSOR, WORK_PTR_LO, WORK_PTR_HI,
  HIT_DISTANCE_THRESHOLD, loc_b3, COORD_DISPATCH_SEL, INITIAL_ACTIVE_COUNT, DSW_DIFFICULTY, LIST_SELECT_FLAGS, FLYER_SLOT_TOP, OBJECT_VELOCITY_HI, OBJECT_VELOCITY_LO,
  CANDIDATE_LANE_0, CANDIDATE_LANE_1, ENEMY_BAND_THRESHOLD_0, ENEMY_BAND_THRESHOLD_1, ENEMY_BAND_THRESHOLD_2, ENEMY_BAND_THRESHOLD_3, ENEMY_BAND_THRESHOLD_4, ENEMY_CLIMB_DELTA_LO_0, ENEMY_CLIMB_DELTA_LO_1,
  ENEMY_CLIMB_DELTA_LO_2, ENEMY_CLIMB_DELTA_LO_3, ENEMY_CLIMB_DELTA_LO_4, ENEMY_CLIMB_DELTA_HI_0, ENEMY_CLIMB_DELTA_HI_1, ENEMY_CLIMB_DELTA_HI_2, ENEMY_CLIMB_DELTA_HI_3, ENEMY_CLIMB_DELTA_HI_4,
  POKEY2_RANDOM, STATE_RESEED_RECORD_TABLE,
} from "./names.js";
import { dispatchRangeValueBySelector } from "./dispatchRangeValueBySelector.js";
import { dispatchCursorAdvanceBySelector } from "./dispatchCursorAdvanceBySelector.js";
import { partitionByteToFineCoarseSeed } from "./partitionByteToFineCoarseSeed.js";

/**
 * reseedStateTables — re-seed the per-wave enemy state tables from a difficulty key. ROM 0x92c5.
 *
 * Role in the machine: at the start of a wave Tempest must fill in the tables that drive
 * enemy behaviour — per-lane climb speeds, active counts, band thresholds, velocity seeds —
 * scaled to how far into the game the player is and to the operator difficulty switch. This
 * routine builds a single "how hard should this wave be" search key, uses it to look up a
 * value out of a table-of-lists for each of a run of destination cells, then applies
 * difficulty trims and fans a few folded seeds out across the enemy-parameter cells. It is
 * called from the wave-spawn chain (selectWaveStartSlot / tickWaveSpawnCadence).
 *
 * Behavior — three stages:
 *  1. Search key: take loc_9f (the wave/progress index); if it is >= 98 it is off the top of
 *     the tables, so replace it with a fresh pseudo-random value (POKEY2_RANDOM & 0x1f) | 0x40.
 *     Store it in loc_2b and then increment it by one.
 *  2. Table walk: for record index 111 down to 3 stepping -4, read a 4-byte record from
 *     STATE_RESEED_RECORD_TABLE giving a source-list pointer (lo/hi) and a destination pointer
 *     (lo/hi). Scan the source list of [entry, lo, hi] triples for the range that brackets the
 *     key; the first bracketing range yields a resolved byte (via dispatchRangeValueBySelector),
 *     an exhausted list (entry 0) yields 0. Store the resolved byte through the destination
 *     pointer. dispatchCursorAdvanceBySelector steps the cursor past a non-matching entry.
 *  3. Difficulty trim + fold: on DSW_DIFFICULTY & 3, mode 1 nudges values down and mode 2 up
 *     (adjusting FLYER_SLOT_TOP, the climb-delta and active-count cells, and a list-select bit).
 *     Then fold ENEMY_CLIMB_DELTA_LO_3 / OBJECT_VELOCITY_LO / ENEMY_CLIMB_DELTA_LO_0 through
 *     partitionByteToFineCoarseSeed and fan each [A,X,Y] out into its satellite delta/threshold
 *     cells, derive the _4 pair by a left shift, and hard-seed the remaining lane/threshold cells.
 *
 * Live-out: the whole enemy-parameter cell family — ENEMY_CLIMB_DELTA_LO_* and HI_*,
 * ENEMY_BAND_THRESHOLD_*, CANDIDATE_LANE_0/1, OBJECT_VELOCITY_LO/HI, HIT_DISTANCE_THRESHOLD,
 * INITIAL_ACTIVE_COUNT, FLYER_SLOT_TOP, LIST_SELECT_FLAGS — plus every destination cell the
 * table walk wrote, and the scratch key loc_2b.
 *
 * Returns the exit [X, Y] the ROM leaves: the last fold's X and Y seeds (nothing after it loads either).
 * Grounding: [seen].
 */
export function reseedStateTables(m) {
  const { mem8, mem16 } = m;

  // search key: loc_9f, unless >= 98 -> a fresh value from (the POKEY random register & 0x1f) | 0x40; then +1
  let key = mem8[loc_9f];
  if (key >= 98) key = (mem8[POKEY2_RANDOM] & 0x1f) | 0x40;
  mem8[loc_2b] = key;
  mem8[loc_2b] = mem8[loc_2b] + 1;   // +1 -> the final value every source list is searched against

  // record index 111 -> 3, step -4 (stop when it underflows past 3 to 255)
  mem8[SLOT_LOOP_INDEX] = 111;
  while (true) {
    const index = mem8[SLOT_LOOP_INDEX];
    mem8[WORK_PTR_HI] = mem8[u16(STATE_RESEED_RECORD_TABLE + index + 3)];
    mem8[WORK_PTR_LO] = mem8[u16(STATE_RESEED_RECORD_TABLE + index + 2)];
    mem8[COORD_LIST_PTR_HI] = mem8[u16(STATE_RESEED_RECORD_TABLE + index + 1)];
    mem8[COORD_LIST_PTR_LO] = mem8[u16(STATE_RESEED_RECORD_TABLE + index)];
    mem8[TABLE_CURSOR] = 1;   // reset the per-record dispatch cursor before scanning this list

    // scan the source list for the [lo, hi] range that brackets the search key
    let resolved = 0;   // byte to store; stays 0 if no range brackets the key
    let y = 0;          // cursor into the source list
    while (true) {
      const listPtr = mem16[COORD_LIST_PTR_LO];
      const entry = mem8[u16(listPtr + y)];
      mem8[COORD_DISPATCH_SEL] = entry;
      if (entry === 0) { resolved = 0; break; } // list exhausted
      const k = mem8[loc_2b];   // the search key built in stage 1
      y = u8(y + 1);
      const lo = mem8[u16(listPtr + y)];
      y = u8(y + 1);
      let advance = k < lo;   // below the low bound -> this triple can't bracket, keep scanning
      if (!advance) {
        const hi = mem8[u16(listPtr + y)];
        advance = k > hi;   // above the high bound -> also no bracket; else it's a hit
        if (!advance) {                     // lo <= key <= hi -> range hit
          y = u8(y + 1);
          const r = dispatchRangeValueBySelector(m, y);         // yields the byte to store (first element if it also returns an index)
          resolved = Array.isArray(r) ? r[0] : r;
          break;
        }
      }
      const [, yy] = dispatchCursorAdvanceBySelector(m, y);        // the step helper advances the cursor; continue from it
      y = yy;
    }

    mem8[u16(mem16[WORK_PTR_LO])] = resolved;    // store through the destination pointer

    mem8[SLOT_LOOP_INDEX] = u8(index - 4);   // step -4 to the next record
    if (mem8[SLOT_LOOP_INDEX] === 255) break;
  }

  // rescale on DSW_DIFFICULTY & 3: 1 -> down, 2 -> up, else none
  const mode = mem8[DSW_DIFFICULTY] & 0x03;
  if (mode === 1) {
    mem8[FLYER_SLOT_TOP] = u8(mem8[FLYER_SLOT_TOP] - 1);
    const v = mem8[ENEMY_CLIMB_DELTA_LO_0];
    const inv = v ^ 0xff;
    mem8[ENEMY_CLIMB_DELTA_LO_0] = (inv >> 3) + v + ((inv >> 2) & 1);
    if (mem8[loc_9f] < 17) mem8[loc_b3] = u8(mem8[loc_b3] - 1);   // early-wave extra easing
  } else if (mode === 2) {
    const bumped = u8(mem8[FLYER_SLOT_TOP] + 1);
    mem8[FLYER_SLOT_TOP] = bumped >= 3 ? 3 : bumped;
    const v = mem8[ENEMY_CLIMB_DELTA_LO_0];
    mem8[ENEMY_CLIMB_DELTA_LO_0] = ((v >> 3) | 0xe0) + v + ((v >> 2) & 1);
    const w = mem8[INITIAL_ACTIVE_COUNT];
    mem8[INITIAL_ACTIVE_COUNT] = (w >> 3) + w + ((w >> 2) & 1);
    mem8[LIST_SELECT_FLAGS] = mem8[LIST_SELECT_FLAGS] | 0x40;   // hard mode selects the alternate list set
  }

  // fold three cells through the helper (returns [A, X, Y]) and fan the results out
  const [a163, x163, y163] = partitionByteToFineCoarseSeed(m, mem8[ENEMY_CLIMB_DELTA_LO_3]);
  mem8[ENEMY_CLIMB_DELTA_LO_3] = a163;
  mem8[ENEMY_CLIMB_DELTA_HI_3] = y163;   // Y seed -> lane-3 climb-delta high byte
  mem8[ENEMY_BAND_THRESHOLD_3] = x163;

  const [a120, x120, y120] = partitionByteToFineCoarseSeed(m, mem8[OBJECT_VELOCITY_LO]);
  mem8[OBJECT_VELOCITY_LO] = a120;
  mem8[OBJECT_VELOCITY_HI] = y120;
  mem8[HIT_DISTANCE_THRESHOLD] = x120;   // X seed -> the coarse hit-distance threshold

  const [a160, x160, y160] = partitionByteToFineCoarseSeed(m, mem8[ENEMY_CLIMB_DELTA_LO_0]);
  mem8[ENEMY_CLIMB_DELTA_LO_0] = a160;
  mem8[ENEMY_CLIMB_DELTA_LO_2] = a160;
  mem8[ENEMY_CLIMB_DELTA_HI_2] = y160;
  mem8[ENEMY_CLIMB_DELTA_HI_0] = y160;
  mem8[ENEMY_BAND_THRESHOLD_0] = x160;
  mem8[ENEMY_BAND_THRESHOLD_2] = x160;
  mem8[ENEMY_BAND_THRESHOLD_1] = x160;   // one coarse index fans across bands 0/1/2

  mem8[ENEMY_CLIMB_DELTA_LO_4] = mem8[ENEMY_CLIMB_DELTA_LO_0] << 1;               // shift left, carry out is bit 7
  mem8[ENEMY_CLIMB_DELTA_HI_4] = (mem8[ENEMY_CLIMB_DELTA_HI_0] << 1) | (mem8[ENEMY_CLIMB_DELTA_LO_0] >> 7);

  mem8[ENEMY_BAND_THRESHOLD_4] = 6;   // remaining lane-4 / lane-1 cells are hard-seeded constants
  mem8[ENEMY_CLIMB_DELTA_LO_1] = 160;
  mem8[ENEMY_CLIMB_DELTA_HI_1] = 254;
  mem8[CANDIDATE_LANE_1] = 1;
  mem8[CANDIDATE_LANE_0] = 1;   // both candidate-lane cells start at 1
  return [x160, y160];
}
