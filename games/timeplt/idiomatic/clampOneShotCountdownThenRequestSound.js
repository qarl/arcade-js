// SPDX-License-Identifier: GPL-3.0-only
/** clampOneShotCountdownThenRequestSound — stamp one object's state byte to fifty-nine and ask for the sound that goes with
 * it. The stamp is unconditional: nothing here reads the byte first, and nothing chooses between
 * two outcomes. LIVE-OUT: memory.
 *
 * ROM 0x409D-0x40AA. names.js tag: [seen] -- "stamp one object's state byte to fifty-nine and ask for
 * the sound that goes with it; the stamp is unconditional -- nothing here reads the byte first, and the
 * ROM's test at this entry sends both of its answers to the same address".
 *
 * Role in the machine: the per-slot object services use a record's head byte as a countdown/state
 * code. Two of them -- runOneShotAnimatedObjectSlot and stepDriftingCountdownObjectByEraFrames -- call
 * this entry when that byte sits at or above their reset mark, pulling it down to 0x3B (59) so the
 * object's countdown starts from there, and asking for the sound tied to that state
 * (ONE_SHOT_COUNTDOWN_SOUND, 0x2D87 [seen], requested by requestOneShotCountdownSound).
 *
 * `object` is the object's record base -- the index register the calling slot sweep has seated on
 * the current slot's record.
 *
 * Why there is no branch here although the ROM has one: after the store the original loads
 * ERA_INDEX (0xAD04) and tests it (`and a`), but both the `jp z` and the fall-through `jp` land on
 * 0x568E. The test decides only how many cycles the jump costs, never where control goes, so it has
 * no behaviour to carry. */

import { requestOneShotCountdownSound } from "./requestOneShotCountdownSound.js";

// Offset of the state/countdown byte within the object's record (ix+0x00 in the ROM).
const STATE = 0;
// The value the state is pulled back to: 0x3B, the state the paired sound is named for.
const STAMPED_STATE = 59;

export function clampOneShotCountdownThenRequestSound(m, object = m.regs.ix) {
  // `ld (ix+0x00),0x3b` at 0x409D: overwrite the state byte without reading what it held.
  m.mem8[object + STATE] = STAMPED_STATE;
  // Tail jump to 0x568E: request the 0x3B-state sound. That routine's own permission drops the
  // request unless a game is being played, so in the attract demo the stamp happens silently.
  requestOneShotCountdownSound(m);
}
