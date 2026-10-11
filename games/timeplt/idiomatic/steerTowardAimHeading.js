// SPDX-License-Identifier: GPL-3.0-only
/** steerTowardAimHeading — turn an object's heading one step toward the heading it aims at, the
 * short way round, at a rate a small table supplies for the current era.
 *
 * ROLE. The object's record (IX) carries its current heading at +0x02 -- the heading field every
 * actor family shares -- and the heading it is aiming for at +0x01. The heading byte written here
 * is the one the object's own movement routine reads to pick a velocity, so stepping it one notch
 * per call makes the object curve toward its target. The two headings are points on a 256-step
 * circle, so their difference taken as a wrapped byte says how far round the aim lies: under half a
 * turn away and the short way is forward (add), otherwise it is back (subtract). The size of a step
 * is not the object's own -- it is fetched from TURN_RATE_BY_ERA_TABLE (five entries at 0x2C1D)
 * indexed by whatever ERA_INDEX holds at the call; steerEra4CraftTowardAimHeadingThenFly forces that cell to 0 around
 * some of its turns (mechanisms.md), so two objects turning in one frame need not turn alike.
 *
 * ROM 0x2BEF-0x2C1C (frozen lift translated/loc_2bef.js). Grounding: [seen] (names.js ROUTINES
 * 0x2bef). LIVE-OUT: memory only, one byte, and nothing at all once the aim is reached.
 */

import { ERA_INDEX, TURN_RATE_BY_ERA_TABLE } from "./names.js";
import { u8, u16 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";

// Offsets into the object record (IX): the target heading and the current heading.
const AIM_HEADING = 1;
const HEADING = 2;
// Half of the 256-step circle: the boundary between "turn forward" and "turn back".
const HALF_TURN = 128;

/** Close enough to stop turning: the aim at most one step ahead, or two steps behind.
 *  (ROM `add a,0x02 / cp 0x04 / ret c` on the wrapped difference aim - heading.) */
const arrived = (away) => u8(away + 2) < 4;

export function steerTowardAimHeading(m, object = m.regs.ix) {
  const { mem8 } = m;
  // How far round the circle the aim lies from the current heading, as a wrapped byte.
  const headingCell = u16(object + HEADING);
  const heading = mem8[headingCell];
  const away = u8(mem8[u16(object + AIM_HEADING)] - heading);
  // Already there (within the dead band): leave the heading untouched.
  if (arrived(away)) return;

  // One step at the era's turn rate, in the short direction. The ROM's two arms (0x2C03 forward,
  // 0x2C0F back) each fetch the rate the same way; the back arm forms heading - step as
  // `sub b / neg`. The store wraps to a byte, so turning past 0 or 255 goes round the circle.
  const step = turnRate(m, mem8[ERA_INDEX]);
  mem8[headingCell] = away < HALF_TURN ? heading + step : heading - step;
}

/** The table fetch takes its base and its index as arguments: the turn rate for one era, read
 *  through the table-fetch restart at 0x0008 (fetchTableByte). */
function turnRate(m, index) {
  return fetchTableByte(m, TURN_RATE_BY_ERA_TABLE, index);
}
