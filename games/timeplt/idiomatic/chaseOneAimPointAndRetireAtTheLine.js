// SPDX-License-Identifier: GPL-3.0-only
/**
 * chaseOneAimPointAndRetireAtTheLine — ROM 0x4117 [seen]
 *
 * WHAT IT IS. One frame of the "chase" behaviour for a single enemy object: it homes in on a point
 * near the player's ship and is freed once it drifts onto a retire line. The object-bank sweep runs
 * it for a live slot whose countdown at +0x0E has run out.
 *
 * ROLE. Re-aim, turn, move, dress the sprite, retire at the line. Re-aiming is RATIONED rather than
 * done every frame: the object carries a phase byte and the aim is recomputed only on frames whose
 * low four bits match it, which spreads a crowd's cost across sixteen frames and leaves each object
 * a stale aim in between (a phase byte above 15 never matches, so such an object is never
 * re-aimed). The turn, the move and the dressing run every frame regardless.
 *
 * The aim point read is ENEMY_STANDOFF_AIM_MAIN (0xAC7F), one of SIX two-byte points packed at
 * 0xAC74-0xAC7F that layOutEnemyAimPointsFromPlayerHeading rewrites as a block each pass -- so it is
 * ONE point, not THE point, and neither the only one nor fixed. The sibling at 0x41B8 has the same
 * shape but aims at other points of that block.
 *
 * PARAMETERS: object = the object's record (IX in the ROM); sprite = its sprite entry (IY).
 * LIVE-OUT: memory.
 */

import { u16 } from "../../../core/int.js";
import { ENEMY_STANDOFF_AIM_MAIN, FRAME_TICK, SLOWEST_VELOCITY_TABLE } from "./names.js";
import { headingToward } from "./headingToward.js";
import { steerTowardAimOneUnitAFrame } from "./steerTowardAimOneUnitAFrame.js";
import { flyAlongHeadingAtDoubleVelocity } from "./flyAlongHeadingAtDoubleVelocity.js";
import { dressSpriteShapeAndAttributeForHeadingSector } from "./dressSpriteShapeAndAttributeForHeadingSector.js";
import { hasReachedRetireLine } from "./hasReachedRetireLine.js";
import { retireSlot } from "./retireSlot.js";

// Record offsets: +0x0F the object's re-aim phase, +0x01 the heading it aims at.
const TURN_PHASE = 15;
const AIM_HEADING = 1;
// FRAME_TICK's low four bits: the 16-frame wheel the re-aim phase is compared against.
const PHASE_WHEEL = 15;
// the velocity table a chased object flies along
// (0x59D7, the bottom rung of the velocity-table ladder; the ROM reaches it through the call to
// 0x58AA, which loads that table before flying.)
const CHASE_VELOCITY_TABLE = SLOWEST_VELOCITY_TABLE;

export function chaseOneAimPointAndRetireAtTheLine(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;

  // Rationed re-aim (ROM 0x4118-0x412B): only on this object's frame of the sixteen, point its
  // aim heading (+1) at the standoff point. headingToward (0x33B8) returns the 256-step heading
  // from the sprite's position to that point.
  if ((mem8[FRAME_TICK] & PHASE_WHEEL) === mem8[u16(object + TURN_PHASE)]) {
    mem8[u16(object + AIM_HEADING)] = headingToward(m, ENEMY_STANDOFF_AIM_MAIN, sprite);
  }

  // Every frame: turn the heading one unit toward the aim (0x4201), so the object curves round
  // rather than snapping; fly one step along the heading at twice the table velocity plus the
  // world scroll (0x58AA -> flyAlongHeadingAtDoubleVelocity); then point the sprite's shape and
  // attribute the way it now heads (0x3FAF).
  steerTowardAimOneUnitAFrame(m, object);
  flyAlongHeadingAtDoubleVelocity(m, CHASE_VELOCITY_TABLE, object, sprite);
  dressSpriteShapeAndAttributeForHeadingSector(m, object, sprite);

  // Once the object has drifted onto either fixed retire line (hasReachedRetireLine 0x2B83), free
  // its slot (retireSlot 0x40AB, the ROM's tail jump) so the bank can reuse it.
  if (hasReachedRetireLine(m, sprite)) retireSlot(m, object, sprite);
}
