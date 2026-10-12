// SPDX-License-Identifier: GPL-3.0-only
/**
 * sweepShotsOverFiveCraftThenMotherShip — the player's shot sweeps for the stretch of a round in which the
 * Mother-Ship is on the field: sweep the six player shots against FIVE ordinary craft instead of the usual
 * seven, then run the same six shots against the Mother-Ship itself.
 *
 * ROM 0x4FBF-0x5031. Grounding: [seen] (names.js ROUTINES 0x4FBF). The second sweep is the code the ROM falls
 * into at 0x4FE0 (markMotherShipAndShotHitByShots); it is not called.
 *
 * ROLE IN THE MACHINE. dispatchShotSweepByMotherShipArmed sends the pass's shot sweep here while
 * MOTHER_SHIP_ARMED is set, and to a seven-craft sweep otherwise. The Mother-Ship's record is the one at
 * MOTHER_SHIP_STATE (0xA8A0) [seen] and the one a stride on — the last two of the seven ordinary craft slots
 * from CRAFT_RECORD_SLOT0 (0xA850) [seen] (0xA850 plus five strides of 0x10 is 0xA8A0). So while it is out,
 * only the first five craft slots hold craft; choosing the shorter run is the whole of what this entry adds
 * to the first sweep (names.js "why").
 *
 * SWEEP 1 — the craft. destroyTargetsHitByShots (ROM 0x5211) is handed the shot array (PLAYER_SHOT_ARRAY
 * 0xAA80 [seen]), the craft sprite entries (CRAFT_ENTRY_SLOT0 0xAA1A [seen]) and records, five targets, six
 * shots and its hit box; the two scratch cursor cells it reloads between passes are staged first.
 *
 * SWEEP 2 — the Mother-Ship. Runs only while its state byte reads 0xFF (live). Every live shot is tested
 * against the Mother-Ship's position on both axes; a shot inside the box sets BOTH the Mother-Ship's state and
 * the shot's state to 0xF0 ("just hit") and posts a score (postChainedHitScore, ROM 0x51DE). The loop does
 * not re-test the Mother-Ship's state after a hit, so several shots landing in one pass each score.
 * The box on the first axis depends on the era (ERA_INDEX [seen]): wider in eras 0 and 4.
 *
 * LIVE-OUT: memory-only.
 */

import { destroyTargetsHitByShots } from "./destroyTargetsHitByShots.js";
import { postChainedHitScore } from "./postChainedHitScore.js";
import { CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0, ERA_INDEX, MOTHER_SHIP_ENTRY, MOTHER_SHIP_SPRITE_Y, MOTHER_SHIP_STATE, PLAYER_SHOT_ARRAY, SCRATCH_PTR_A, SCRATCH_PTR_B } from "./names.js";
import { within, nextRecordInPage } from "./objectGeometry.js";

/** Sweep 1's parameters, as the ROM loads them: six shots (C), five craft (A' and B), box L = 7 / H = 0x0F. */
const SHOTS = 6;
const TARGETS = 5;
const TARGET_REACH = 7;
const TARGET_SPAN = 15;

/** Sweep 2's record layout: state byte at +0, and a shot's two whole coordinates at +6 and +4 (shots have
 *  no sprite entries). 0xFF is live and 0xF0 just hit, the same alphabet as every object slot. */
const STATE = 0;
const SHOT_FIRST_AXIS = 6;
const SHOT_SECOND_AXIS = 4;
const LIVE = 255;
const JUST_HIT = 240;

/** Sweep 2's hit box. First axis: eras 0 and 4 get L = 8 / H = 0x11 (ROM 0x502B arm), the others
 *  L = 6 / H = 0x0D. Second axis: always E = 0x17 / D = 0x1F. */
const WIDE_ERAS = [0, 4];
const WIDE_REACH = 8;
const WIDE_SPAN = 17;
const NARROW_REACH = 6;
const NARROW_SPAN = 13;
const SECOND_AXIS_REACH = 23;
const SECOND_AXIS_SPAN = 31;

export function sweepShotsOverFiveCraftThenMotherShip(m) {
  const { mem8, mem16 } = m;
  // SWEEP 1. Stage the two scratch cursors (SCRATCH_PTR_B 0xA993 = craft records, SCRATCH_PTR_A 0xA991 =
  // craft sprite entries, both [seen]) that the shared sweep reloads between passes, then run it over the
  // first five craft slots only.
  mem16[SCRATCH_PTR_B] = CRAFT_RECORD_SLOT0;
  mem16[SCRATCH_PTR_A] = CRAFT_ENTRY_SLOT0;
  destroyTargetsHitByShots(
    m, PLAYER_SHOT_ARRAY, CRAFT_ENTRY_SLOT0, CRAFT_RECORD_SLOT0,
    TARGETS, TARGETS, SHOTS, TARGET_REACH, TARGET_SPAN,
  );

  // SWEEP 2 (ROM 0x4FE0 onward). Choose the first-axis box by era, then stop at once unless the
  // Mother-Ship is live (ROM `ld a,(0xa8a0); inc a; ret nz`).
  const wide = WIDE_ERAS.includes(mem8[ERA_INDEX]);
  const reach = wide ? WIDE_REACH : NARROW_REACH;
  const span = wide ? WIDE_SPAN : NARROW_SPAN;
  if (mem8[MOTHER_SHIP_STATE] !== LIVE) return;

  // Walk the six shot records. A live shot whose coordinates fall within the box on both axes — the
  // Mother-Ship's sprite entry byte (0xAA24) against the shot's +6, its sprite Y (0xAA55) against the shot's
  // +4 — marks the Mother-Ship just hit (0xF0) and is spent with it, and the hit is scored. A mark is a
  // hit, not necessarily the kill: the Mother-Ship absorbs hits while MOTHER_SHIP_HITS_TO_ABSORB (0xA8A4) is non-zero.
  let shot = PLAYER_SHOT_ARRAY;
  for (let left = SHOTS; left !== 0; left--) {
    if (mem8[shot + STATE] === LIVE &&
      within(mem8[MOTHER_SHIP_ENTRY], mem8[shot + SHOT_FIRST_AXIS], reach, span) &&
      within(mem8[MOTHER_SHIP_SPRITE_Y], mem8[shot + SHOT_SECOND_AXIS],
        SECOND_AXIS_REACH, SECOND_AXIS_SPAN)) {
      mem8[MOTHER_SHIP_STATE] = JUST_HIT;
      mem8[shot + STATE] = JUST_HIT;
      postChainedHitScore(m);
    }
    shot = nextRecordInPage(shot);
  }
}
