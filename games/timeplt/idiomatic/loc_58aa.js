// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_58aa — fly one object a double step at the pace one fixed table of velocity samples sets.
 *
 * WHAT IT IS: ROM 0x58AA-0x58AF, tag [seen] (names.js ROUTINES 0x58aa). The whole ROM routine is
 * `ld hl,0x59d7 / jp 0x58fe`: it fixes the table at 0x59D7 and hands over to the double-velocity mover,
 * flyAlongHeadingAtDoubleVelocity. Choosing the table and the mover is the whole of this entry, and a
 * pointer the caller held (the ROM's HL) is discarded.
 *
 * ROLE IN THE MACHINE: the era-4 arm steerEnemyTowardShip alternates, on bit 1 of the frame tick,
 * between this entry and flyAtSecondFastestSpeed (names.js 0x5860), so the object does not stay on one
 * rung. The table is the bottom rung of the ladder (206), but the mover doubles the object's own
 * velocity, so this entry moves farther per step than flyAtSecondFastestSpeed's single 306 (names.js
 * "why" for 0x5860).
 *
 * LIVE-OUT: memory (the object's coordinates, written by the mover).
 */

import { flyAlongHeadingAtDoubleVelocity } from "./flyAlongHeadingAtDoubleVelocity.js";
import { SLOWEST_VELOCITY_TABLE } from "./names.js";

/*
 * The table at ROM 0x59D7: 256 16-bit velocity words, the table flyAtSlowestSpeed also uses. The
 * same address is also the derail target of the whole-ROM checksum (names.js).
 */
const VELOCITY_TABLE = SLOWEST_VELOCITY_TABLE;

/*
 * `object` is the object's record (the ROM's IX) and `sprite` its sprite entry (the ROM's IY), passed
 * straight through. The mover adds TWICE the velocity component and the shared world scroll ONCE, so
 * nothing else may drift this object.
 */
export function loc_58aa(m, object = m.regs.ix, sprite = m.regs.iy) {
  flyAlongHeadingAtDoubleVelocity(m, VELOCITY_TABLE, object, sprite);
}
