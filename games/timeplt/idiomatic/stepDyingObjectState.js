// SPDX-License-Identifier: GPL-3.0-only
/** stepDyingObjectState — step one object's state byte and dispatch on its value: the just-hit mark 0xF0 starts the
 * death countdown at 0x3B and counts the kill; the threshold begins the death, then it and any higher
 * value count the byte down one and fly the object on; below it the byte counts down, retiring the
 * slot at zero, else moving it. LIVE-OUT: memory. */
//
// ROM 0x2B93-0x2BB3; lift: translated/loc_2b93.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. Every enemy-craft record starts with a state byte: 0x00 free, 0xFE held, 0xFF
// flying, and ANY OTHER value means the craft is dying and the value is its death countdown. The five
// per-era craft services (serviceEra0EnemyCraftSlot .. serviceEra4EnemyCraftSlot) hand that last case
// here, once per turn. A collision sweep marks a hit object by writing 0xF0 into its state byte, and
// this routine turns the mark into a countdown. It is also WHERE A KILL IS COUNTED: only the seven
// craft slots reach it, and countTheKillAndGrantTheSharedToken is what requests the death sounds and
// takes one off KILLS_REMAINING, the quota that brings on the Mother-Ship (mechanisms.md).
//
// The countdown values 0x3C and above (other than 0xF0) are written by the Mother-Ship's field sweep,
// which gives each swept craft a staggered code so they go down one after another.
//
// `object` is the craft's record (ix) and `sprite` its sprite entry (iy), as the craft service passes them.
// LIVE-OUT: memory -- the state byte, and whatever the kill count, the flight step, the move or the
// retire writes.

import { countTheKillAndGrantTheSharedToken } from "./countTheKillAndGrantTheSharedToken.js";
import { decrementObjectStateThenFlyAtSlowestSpeed } from "./decrementObjectStateThenFlyAtSlowestSpeed.js";
import { moveObjectByStateByteThenRunAppearance } from "./moveObjectByStateByteThenRunAppearance.js";
import { retireSlotAndSubPixel } from "./retireSlotAndSubPixel.js";
import { u8 } from "../../../core/int.js";

// The state byte is record +0. 0xF0 is the collision sweeps' "just hit" mark; it is replaced by
// 0x3B, the start of the death countdown, one below the threshold 0x3C at which the shared "death begins" step runs.
const STATE = 0;
const JUST_HIT = 0xf0;
const DEATH_COUNTDOWN_START = 0x3b;
const DEATH_BEGINS = 0x3c;

export function stepDyingObjectState(m, object = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  const state = mem8[object + STATE];

  // Freshly hit (`cp 0xf0 / jp z,0x2bac`): start the countdown at 0x3B and count the kill
  // (`ld (ix+0x00),0x3b / call 0x2bba` at 0x2BAC-0x2BB0).
  if (state === JUST_HIT) {
    mem8[object + STATE] = DEATH_COUNTDOWN_START;
    return countTheKillAndGrantTheSharedToken(m, object);
  }

  // At the threshold the kill is counted first; every return from that step leaves the carry clear (the token grant adds 0x80 to the record's small slot ordinal), so every value at or above the threshold flies on.
  if (state === DEATH_BEGINS) countTheKillAndGrantTheSharedToken(m, object);
  if (state >= DEATH_BEGINS) return decrementObjectStateThenFlyAtSlowestSpeed(m, object, sprite);

  // Below the threshold: take one off the countdown (`dec (ix+0x00)` at 0x2BA3). At zero the object is
  // gone -- retire the slot, zeroing its record and sprite coordinates (0x2BDE). Otherwise move it for
  // the frame by its state byte and run its appearance step (0x2C22), which also steps the byte down
  // again while it is 32 or more.
  const stepped = u8(state - 1);
  mem8[object + STATE] = stepped;
  if (stepped === 0) return retireSlotAndSubPixel(m, object, sprite);
  return moveObjectByStateByteThenRunAppearance(m, object, sprite);
}
