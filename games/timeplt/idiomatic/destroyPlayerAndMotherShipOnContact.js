// SPDX-License-Identifier: GPL-3.0-only
/**
 * destroyPlayerAndMotherShipOnContact — ROM 0x50EE [seen]
 *
 * WHAT IT IS. The ramming test between the player's ship and the Mother-Ship: flying into it
 * destroys both. Its caller destroyPlayerAndMotherShipOnContactByEra selects this arm in eras 0 and 4 because its
 * first-axis window is the wider of the two; the other eras run the same destruction inline with a
 * narrower window.
 *
 * ROLE. Both must be live (PLAYER_STATE 0xA800, MOTHER_SHIP_STATE 0xA8A0) and their coordinates
 * must fall inside a box around the Mother-Ship: -8..+8 on the first axis and an off-centre -25..+9
 * on the second. When it holds, both state bytes take the destroyed code, the Mother-Ship's
 * remaining-hit count at record +4 (MOTHER_SHIP_HITS_TO_ABSORB 0xA8A4) is zeroed so the contact
 * destroys it outright instead of costing it one of the hits it can absorb (the arming path seeds
 * seven), and the chained
 * hit score is posted -- reached by transfer, not call, so that routine's return carries it. Any
 * of the four tests failing leaves all untouched.
 *
 * LIVE-OUT: memory.
 */

import { postChainedHitScore } from "./postChainedHitScore.js";
import { MOTHER_SHIP_ENTRY, MOTHER_SHIP_HITS_TO_ABSORB, MOTHER_SHIP_SPRITE_Y, MOTHER_SHIP_STATE, PLAYER_ENTRY, PLAYER_SPRITE_Y, PLAYER_STATE } from "./names.js";
import { within } from "./objectGeometry.js";

// The slot alphabet: 0xFF live, 0xF0 just hit (for the player, the start of the death).
const LIVE = 255;
const DESTROYED = 240;

// The contact box. `within` accepts a difference (Mother-Ship - player) from -reach to
// span - reach - 1: first axis -8..+8, second axis -25..+9.
const FIRST_AXIS_REACH = 8;
const FIRST_AXIS_SPAN = 17;
const SECOND_AXIS_REACH = 25;
const SECOND_AXIS_SPAN = 35;

export function destroyPlayerAndMotherShipOnContact(m) {
  const { mem8 } = m;
  // Tests 1 and 2: both craft still live.
  if (mem8[PLAYER_STATE] !== LIVE) return;
  if (mem8[MOTHER_SHIP_STATE] !== LIVE) return;
  // Test 3: the Mother-Ship's sprite entry +0 (0xAA24) against the player's (0xAA10).
  if (!within(mem8[MOTHER_SHIP_ENTRY], mem8[PLAYER_ENTRY], FIRST_AXIS_REACH, FIRST_AXIS_SPAN)) return;
  // Test 4: the Mother-Ship's sprite Y (MOTHER_SHIP_SPRITE_Y 0xAA55) against the player's (PLAYER_SPRITE_Y 0xAA41).
  if (
    !within(mem8[MOTHER_SHIP_SPRITE_Y], mem8[PLAYER_SPRITE_Y],
      SECOND_AXIS_REACH, SECOND_AXIS_SPAN)
  ) {
    return;
  }

  // Contact: both take the destroyed code, the Mother-Ship's absorbable hits are cleared so it
  // cannot shrug the ramming off, and the score is posted (postChainedHitScore 0x51DE, a tail
  // transfer in the ROM).
  mem8[PLAYER_STATE] = DESTROYED;
  mem8[MOTHER_SHIP_STATE] = DESTROYED;
  mem8[MOTHER_SHIP_HITS_TO_ABSORB] = 0;
  postChainedHitScore(m);
}
