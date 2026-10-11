// SPDX-License-Identifier: GPL-3.0-only
/** moveObjectByStateByteThenRunAppearance — move one object for the frame according to its state byte, then run the shared
 * appearance step over that same object. From thirty-two up the object counts its state byte down
 * and flies on at the slowest table speed; below thirty-two the mover only drifts it with the world and
 * leaves the state byte alone. The appearance step runs on both paths, and below ten it can itself step
 * the state byte up or zero it.
 * LIVE-OUT: memory. */
//
// ROM 0x2C22-0x2C30 (lift: translated/loc_2c22.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. Every object in play carries a state byte at the head of its record (0xFF live,
// 0xF0 just hit -- mechanisms.md §6). Once the object is marked to die the byte becomes a death countdown
// (from 0x3B after a collision hit, from a staggered code, 0x14 upward by slot, for a craft caught in the Mother-Ship's
// field sweep), and stepDyingObjectState steps it; while the count, once stepped, is below 0x3C and not yet zero, that routine hands
// the frame's move to this entry. Per mechanisms.md §6, the wreck flies on at the slowest speed while
// the count is high and afterwards only drifts with the world, while the appearance step animates it
// off the same count.
//
// PARAMETERS. `object` is the object's record (the ROM's IX) and `sprite` its sprite entry (IY), both
// seated by the caller and passed on unchanged.
//
// LIVE-OUT: memory only -- the state byte (counted down by the mover from 0x20 up; below 0x0A the
// appearance step steps it up, or zeroes it when it retires the slot), the object's coordinates, the
// shape and tint written by the appearance step, and, in that lowest band, a command-ring entry and
// the request cell 0xA821 it clears.

import { driftWithWorldScroll } from "./driftWithWorldScroll.js";
import { decrementObjectStateThenFlyAtSlowestSpeed } from "./decrementObjectStateThenFlyAtSlowestSpeed.js";
import { driveObjectAppearanceByPhaseBand } from "./driveObjectAppearanceByPhaseBand.js";

// The state byte is the record's first byte (`ld a,(ix+0x00)`), and 0x20 (thirty-two) is the split
// point (`cp 0x20`, then `jp nc` at 0x2C2B -- "not below 0x20" takes the counting path).
const STATE = 0;
const COUNTDOWN_FROM = 32;

export function moveObjectByStateByteThenRunAppearance(m, object = m.regs.ix, sprite = m.regs.iy) {
  // CHOOSE THE MOVE. From 0x20 up (jp nc,0x2BB4): count the state byte down one and fly on at the
  // slowest velocity-table speed. Below 0x20 (jp 0x2B60): leave the state byte alone and only add the
  // frame's world-scroll displacement, so the wreck simply drifts with the world.
  if (m.mem8[object + STATE] >= COUNTDOWN_FROM) decrementObjectStateThenFlyAtSlowestSpeed(m, object, sprite);
  else driftWithWorldScroll(m, object, sprite);

  // THEN THE APPEARANCE, ON BOTH PATHS. The ROM pushes 0x2C31 as a continuation before either jump, so
  // whichever mover runs, its `ret` lands in the appearance step at 0x2C31: it picks the object's
  // tint or shape from the same state byte (three bands), or retires the slot.
  driveObjectAppearanceByPhaseBand(m, object, sprite);
}
