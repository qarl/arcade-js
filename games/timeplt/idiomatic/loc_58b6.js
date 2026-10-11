// SPDX-License-Identifier: GPL-3.0-only
/** loc_58b6 — fly one object a step at twice the velocity one fixed table of samples sets, the
 * shared drift added once; choosing that table is all this entry does. LIVE-OUT: memory.
 *
 * ROM 0x58B6-0x58BB (frozen lift translated/loc_58b6.js: `ld hl,0x5e00 / jp 0x58fe`).
 * Grounding: [seen] (names.js ROUTINES 0x58b6).
 *
 * ROLE IN THE MACHINE. flyAlongHeadingAtDoubleVelocity (0x58FE) is the fast mover: it reads the
 * heading out of the object's record, looks up two perpendicular velocity components in whatever
 * table it is handed, and adds TWICE each component plus the world scroll once to the object's
 * two coordinates. It does not choose a table itself; it is entered only through two-instruction
 * shims like this one, each of which seats a table address and tail-jumps in. That choice of
 * table is the whole of what this entry contributes — the object record and sprite entry come
 * straight through from the caller.
 *
 * The table seated here is OPENING_ERA_VELOCITY_TABLE (0x5E00), the ROM velocity table that
 * scrollWorldAtTheEraPace also uses for the opening era's world pace (names.js). This is one of a
 * family of hex-named entries -- the table shims 0x58B6, 0x598E, 0x5994, 0x59C5, 0x59CB and 0x59D1, plus
 * 0x599D, the shared heading-read entry that 0x598E and 0x5994 jump to and which seats no table of its own -- that differ
 * in the table immediate, in where the heading comes from, or in the body they enter (the double-velocity mover here, the doubled lookup for the rest); names.js keeps them all hex
 * because nothing reachable from a shim settles what class of object moves at its pace.
 * Kept as the ROUTINES override of 0x58B6: no idiomatic module calls
 * it, because its callers hand the mover the table themselves.
 */

import { flyAlongHeadingAtDoubleVelocity } from "./flyAlongHeadingAtDoubleVelocity.js";
import { OPENING_ERA_VELOCITY_TABLE } from "./names.js";

// The table this shim fixes: the ROM's `ld hl,0x5e00`.
const VELOCITY_TABLE = OPENING_ERA_VELOCITY_TABLE;

// `object` and `sprite` are the object's record and its sprite entry (the ROM's IX and IY), which the
// ROM's caller seats; no routine in this layer calls this entry. They are handed on as arguments
// from here.
export function loc_58b6(m, object = m.regs.ix, sprite = m.regs.iy) {
  // `jp 0x58fe` — a tail jump, so the mover's `ret` returns straight to our caller.
  flyAlongHeadingAtDoubleVelocity(m, VELOCITY_TABLE, object, sprite);
}
