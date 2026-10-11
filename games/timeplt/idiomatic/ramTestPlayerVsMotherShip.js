// SPDX-License-Identifier: GPL-3.0-only
/** ramTestPlayerVsMotherShip — pick the collision box for the mutual kill of the player and one fixed two-slot
 * target by the era, then run it. In two of the eras the wider first-axis box applies and control
 * transfers to that check; in the rest the same destruction runs here with a narrower first-axis
 * box. Both things must be live and their coordinates must fall inside the box; when they do, both
 * take the destroyed code, the Mother-Ship's remaining-hit count is cleared, and the chained hit
 * score is posted. Any one test failing leaves everything untouched. LIVE-OUT: memory.
 *
 * ROM 0x50B1-0x50ED. Grounding: [seen] (names.js ROUTINES 0x50b1).
 *
 * ROLE IN THE MACHINE. This is the "ramming" test between the player's ship and the Mother-Ship,
 * the large two-slot boss craft whose record starts at MOTHER_SHIP_STATE 0xA8A0 [seen]. The
 * round engine's collision pass reaches it through splitCollisionWorkByFrameParity and
 * runAllCollisionSweepsThisFrame, only while the Mother-Ship is armed (names.js 0x4ebc). A touch
 * kills both: the player loses a life and the Mother-Ship is destroyed outright rather than
 * losing one of its hits, because MOTHER_SHIP_HITS_TO_ABSORB 0xA8A4 [seen] -- the hits it can still
 * absorb -- is zeroed here.
 *
 * THE BOX. Every collision test in this game compares two sprite entries' whole-part coordinates
 * on the board's two native axes (the entry's +0x00 byte and its +0x31 byte) as a wrapped byte
 * difference. Adding a "reach" to the difference and requiring the result to be below a "span"
 * accepts differences from -reach up to span-reach-1, so the box can be lopsided.
 */

import { destroyPlayerAndMotherShipOnContact } from "./destroyPlayerAndMotherShipOnContact.js";
import { postChainedHitScore } from "./postChainedHitScore.js";
import { ERA_INDEX, MOTHER_SHIP_ENTRY, MOTHER_SHIP_HITS_TO_ABSORB, MOTHER_SHIP_SPRITE_Y, MOTHER_SHIP_STATE, PLAYER_ENTRY, PLAYER_SPRITE_Y, PLAYER_STATE } from "./names.js";
import { within } from "./objectGeometry.js";

// Eras 0 (1910) and 4 (2001) use the wider first-axis box; the ROM tests `and a` then `cp 0x04`
// on ERA_INDEX and jumps to 0x50EE on either match.
const WIDE_WINDOW_ERAS = [0, 4];
// The shared slot alphabet: 0xFF is live, 0xF0 is "just hit" and starts the death countdown.
const LIVE = 255;
const DESTROYED = 240;

// Narrow first-axis box: difference -6..+6 (13 values). Second-axis box: -25..+9 (35 values),
// the lopsided window mechanisms.md describes for this contact.
const FIRST_AXIS_REACH = 6;
const FIRST_AXIS_SPAN = 13;
const SECOND_AXIS_REACH = 25;
const SECOND_AXIS_SPAN = 35;

export function ramTestPlayerVsMotherShip(m) {
  const { mem8 } = m;
  // Step 1 -- choose the box. In the first and last eras the wider first-axis test lives in its
  // own routine (destroyPlayerAndMotherShipOnContact, ROM 0x50EE), so control simply goes there.
  if (WIDE_WINDOW_ERAS.includes(mem8[ERA_INDEX])) return destroyPlayerAndMotherShipOnContact(m);

  // Step 2 -- both parties must be live (0xFF). A player already dying, or a Mother-Ship slot
  // that is free or counting down, cannot collide. The ROM tests each with `inc a / ret nz`.
  if (mem8[PLAYER_STATE] !== LIVE) return;
  if (mem8[MOTHER_SHIP_STATE] !== LIVE) return;
  // Step 3 -- the first native axis: Mother-Ship entry +0x00 (0xAA24) against the player's
  // entry +0x00 (0xAA10), accepted within 6 either side.
  if (!within(mem8[MOTHER_SHIP_ENTRY], mem8[PLAYER_ENTRY], FIRST_AXIS_REACH, FIRST_AXIS_SPAN)) return;
  // Step 4 -- the second native axis: MOTHER_SHIP_SPRITE_Y (0xAA55 = entry +0x31) against the
  // player's (PLAYER_SPRITE_Y 0xAA41), accepted from 25 below to 9 above.
  if (
    !within(mem8[MOTHER_SHIP_SPRITE_Y], mem8[PLAYER_SPRITE_Y],
      SECOND_AXIS_REACH, SECOND_AXIS_SPAN)
  ) {
    return;
  }

  // Step 5 -- the touch. Both state bytes take 0xF0, which starts each one's death countdown.
  // Zeroing the remaining-hit count means the Mother-Ship's handler cannot absorb this as one
  // hit and put the ship back to live: it proceeds straight into its destruction.
  mem8[PLAYER_STATE] = DESTROYED;
  mem8[MOTHER_SHIP_STATE] = DESTROYED;
  mem8[MOTHER_SHIP_HITS_TO_ABSORB] = 0;
  // Step 6 -- pay for the kill through the chained-hit scorer (ROM tail `jp 0x51de`), which
  // steps the award up while hits keep landing inside the chain window.
  postChainedHitScore(m);
}
