// SPDX-License-Identifier: GPL-3.0-only
/**
 * markEra1BomberAndShotHitByShots — ROM 0x4F7E [seen]
 *
 * WHAT IT IS. The collision test between the player's bullets and the era-1 bomber held in
 * era-object slot 0 (record ERA_OBJECT_RECORD_SLOT0 0xA8C0, sprite entry ERA_OBJECT_ENTRY_SLOT0
 * 0xAA28). The bullets are the six 16-byte shot records at PLAYER_SHOT_ARRAY (0xAA80), which
 * fireAndSweepPlayerShots arms on a fire-button press.
 *
 * ROLE. Run the target against the whole shot array and destroy the shots that reached it. The
 * target's state byte is tested for "live" ONCE, before the sweep, and never re-tested, so several
 * shots can be spent on it in a single pass: each live slot is tested on both axes as a wrapped
 * window around the target, and a slot inside both is marked 0xF0 together with the target (the shot sweep culls the shot; the
 * bomber's own handler counts the mark as one hit),
 * and a score is posted for it. The slot cursor steps only the low half of its address, so a wide
 * enough array would wrap inside its page. Under MAME both stores were seen to fire.
 *
 * LIVE-OUT: memory only (the 0xF0 marks on the target and shots, the score it posts); its one caller
 * seeds its next sweep afresh, so nothing the sweep leaves behind is read after it.
 */

import { postChainedHitScore } from "./postChainedHitScore.js";
import { u8 } from "../../../core/int.js";
import { ERA_OBJECT_ENTRY_SLOT0, ERA_OBJECT_RECORD_SLOT0, ERA_OBJECT_SPRITE_Y_SLOT0, PLAYER_SHOT_ARRAY } from "./names.js";

// Six shot records, 16 bytes apart (ROM: ld b,0x06; the cursor's low byte steps by 0x10).
const SLOTS = 6;
const SLOT_STRIDE = 0x10;

// Shot-record offsets: +0 occupancy, +6 and +4 the two coordinates (the same offsets
// destroyTargetsHitByShots reads on this array).
const OCCUPANCY = 0;
const SHOT_FIRST_AXIS = 6;
const SHOT_SECOND_AXIS = 4;

// The hit box, as a wrapped window: (target - shot + SLACK) mod 256 < WINDOW accepts a difference
// target - shot from -SLACK up to WINDOW - SLACK - 1. First axis: -6..+6; second: -0x17..+7.
// (ROM 0x4F7E loads these into L, H, E and D before the loop.)
const FIRST_AXIS_SLACK = 6;
const FIRST_AXIS_WINDOW = 0x0d;
const SECOND_AXIS_SLACK = 0x17;
const SECOND_AXIS_WINDOW = 0x1f;

// State bytes: 0xFF live; 0xF0 hit (the shot is culled; the bomber counts it as one hit).
const LIVE = 0xff;
const HIT_MARK = 0xf0;

export function markEra1BomberAndShotHitByShots(m) {
  const { mem8 } = m;
  // No live target, nothing to hit (ROM: inc a / ret nz on the state byte at 0xA8C0).
  if (mem8[ERA_OBJECT_RECORD_SLOT0] !== LIVE) return;

  let slot = PLAYER_SHOT_ARRAY;
  for (let i = 0; i < SLOTS; i++) {
    // Only a shot still in flight can hit.
    if (mem8[slot + OCCUPANCY] === LIVE) {
      // Compare the target's entry +0 (0xAA28) and its sprite Y (ERA_OBJECT_SPRITE_Y_SLOT0 0xAA59,
      // entry +0x31) with the shot's two coordinates, each inside its window.
      const across = u8(mem8[ERA_OBJECT_ENTRY_SLOT0] - mem8[slot + SHOT_FIRST_AXIS] + FIRST_AXIS_SLACK);
      const along = u8(mem8[ERA_OBJECT_SPRITE_Y_SLOT0] - mem8[slot + SHOT_SECOND_AXIS] + SECOND_AXIS_SLACK);
      if (across < FIRST_AXIS_WINDOW && along < SECOND_AXIS_WINDOW) {
        // A hit: mark the target and this shot 0xF0, and post the score through
        // postChainedHitScore (0x51DE), which steps the award up while hits keep chaining.
        mem8[ERA_OBJECT_RECORD_SLOT0] = HIT_MARK;
        mem8[slot + OCCUPANCY] = HIT_MARK;
        postChainedHitScore(m);
      }
    }
    // Next record: add 0x10 to the low byte of the cursor only (ROM: ld a,iyl / add a,0x10).
    slot = (slot - (slot & 0xff)) | u8(slot + SLOT_STRIDE);
  }
}
