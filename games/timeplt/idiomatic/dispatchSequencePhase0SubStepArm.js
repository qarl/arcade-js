// SPDX-License-Identifier: GPL-3.0-only
/** dispatchSequencePhase0SubStepArm — run the arm the low three bits of the inner sequence step select out of a word table laid down inline just behind
 * this entry. The table never changes while the game runs, so each case below is the literal target its
 * slot held, dispatched directly rather than through a jump computed from the read-out value. Only two of
 * the eight slots name a transcribed arm; the other six point at bytes that carry no routine, so reaching
 * one is a fault and it is raised, not assumed away. Neither arm reads the selector value the read-out
 * arithmetic leaves behind, so nothing is handed in. LIVE-OUT: memory, and the arm's.
 * ROM 0x15C2-0x15C7. Grounding: [seen] (names.js ROUTINES 0x15C2). */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { SEQUENCE_SUBSTEP } from "./names.js";
import { startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase } from "./startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase.js";
import { armAttractScreenShowingHighScore } from "./armAttractScreenShowingHighScore.js";

const ARM_MASK = 0x07;

export function dispatchSequencePhase0SubStepArm(m) {
  const index = m.mem8[SEQUENCE_SUBSTEP] & ARM_MASK;
  switch (index) {
    // Slot 0 -> the whole-plane-wipe arm (its inline table word). Slot 6 -> the attract high-score
    // arm.
    case 0: return startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase(m);
    case 6: return armAttractScreenShowingHighScore(m);
    // Slots 1-5 and 7 hold words that address bytes this port has not transcribed as routines; the
    // inline dispatch would jump into them and fault, so surface the same fault here instead.
    default:
      throw new NotImplemented(`dispatchSequencePhase0SubStepArm: phase-0 sub-step arm ${index} is not a transcribed routine`);
  }
}
