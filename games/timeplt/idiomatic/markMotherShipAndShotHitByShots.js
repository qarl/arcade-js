// SPDX-License-Identifier: GPL-3.0-only
/**
 * markMotherShipAndShotHitByShots — ROM 0x4FE0 [seen]
 *
 * WHAT IT IS. The collision test between the player's bullets and the Mother-Ship, the large
 * two-slot craft whose record starts at MOTHER_SHIP_STATE (0xA8A0) and whose sprite entry is
 * MOTHER_SHIP_ENTRY (0xAA24). The bullets are the six 16-byte shot records at PLAYER_SHOT_ARRAY
 * (0xAA80). dispatchEra4CollisionByFrameParity jumps here (507B jp 0x4fe0), and sweepShotsOverFiveCraftThenMotherShip (0x4FBF) falls into it.
 *
 * ROLE. Sweep the six shot slots for one that has reached the Mother-Ship and mark both hit. The
 * Mother-Ship's state must be live or the sweep doesn't run. Each slot must be live too, with both
 * coordinates inside a box centred on the Mother-Ship -- not square, and its first axis widened for
 * two of the era values (the only thing the era decides here; the ROM does it by loading a
 * different pair of window constants, not with a second body). A slot that passes takes the
 * hit code 0xF0, the Mother-Ship takes it too, and the chained hit score is posted. The Mother-Ship
 * is tested live only once, before the sweep, so the remaining slots are still run with it already
 * marked and one pass can pay for several. Marking it here is a hit, not necessarily
 * its death: loc_43f0 spends one of the hits it can absorb (record +4) before it dies.
 * Slots step a record at a time without leaving their page.
 *
 * LIVE-OUT: memory.
 */

import { u16 } from "../../../core/int.js";
import { ERA_INDEX, MOTHER_SHIP_ENTRY, MOTHER_SHIP_SPRITE_Y, MOTHER_SHIP_STATE, PLAYER_SHOT_ARRAY } from "./names.js";
import { postChainedHitScore } from "./postChainedHitScore.js";
import { within, nextRecordInPage } from "./objectGeometry.js";

// Six shot records (16 bytes apart); +0 is the record's state, +6 and +4 its two coordinates.
const SLOT_COUNT = 6;
const STATE = 0;
const SLOT_FIRST_AXIS = 6;
const SLOT_SECOND_AXIS = 4;

// The slot alphabet: 0xFF live, 0xF0 just hit.
const LIVE = 255;
const HIT_MARK = 240;

// The hit box. `within` accepts a difference (Mother-Ship - shot) from -reach to span - reach - 1:
// first axis -8..+8 in eras 0 and 4 (ROM 0x4FE0: ld a,(0xad04) / jr z,0x502b / cp 0x04),
// -6..+6 in the others;
// second axis always -0x17..+7.
const WIDE_ERAS = [0, 4];
const FIRST_AXIS_REACH_WIDE = 8;
const FIRST_AXIS_SPAN_WIDE = 17;
const FIRST_AXIS_REACH = 6;
const FIRST_AXIS_SPAN = 13;
const SECOND_AXIS_REACH = 23;
const SECOND_AXIS_SPAN = 31;

export function markMotherShipAndShotHitByShots(m) {
  const { mem8 } = m;
  // Pick the first-axis window by era (ERA_INDEX 0xAD04) before anything else, as the ROM does.
  const wide = WIDE_ERAS.includes(mem8[ERA_INDEX]);
  const reach = wide ? FIRST_AXIS_REACH_WIDE : FIRST_AXIS_REACH;
  const span = wide ? FIRST_AXIS_SPAN_WIDE : FIRST_AXIS_SPAN;

  // No live Mother-Ship, no sweep (ROM 0x4FF8-0x4FFC: ld a,(0xa8a0) / inc a / ret nz).
  if (mem8[MOTHER_SHIP_STATE] !== LIVE) return;

  let slot = PLAYER_SHOT_ARRAY;
  for (let left = SLOT_COUNT; left !== 0; left--) {
    // A live shot whose coordinates sit inside the box around the Mother-Ship's sprite entry +0
    // (0xAA24) and sprite Y (MOTHER_SHIP_SPRITE_Y 0xAA55, entry +0x31) is a hit.
    if (
      mem8[u16(slot + STATE)] === LIVE &&
      within(mem8[MOTHER_SHIP_ENTRY], mem8[u16(slot + SLOT_FIRST_AXIS)], reach, span) &&
      within(mem8[MOTHER_SHIP_SPRITE_Y], mem8[u16(slot + SLOT_SECOND_AXIS)],
        SECOND_AXIS_REACH, SECOND_AXIS_SPAN)
    ) {
      // Mark both hit and post the score (postChainedHitScore 0x51DE steps the award up while
      // consecutive hits keep landing inside the chain window).
      mem8[MOTHER_SHIP_STATE] = HIT_MARK;
      mem8[u16(slot + STATE)] = HIT_MARK;
      postChainedHitScore(m);
    }
    // Next record: add 16 to the low byte of the cursor only (ROM 0x5022-0x5026: ld a,iyl / add a,0x10 / ld iyl,a).
    slot = nextRecordInPage(slot);
  }
}
