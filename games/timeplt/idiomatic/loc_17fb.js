// SPDX-License-Identifier: GPL-3.0-only
/** loc_17fb — a sequence step that does no work of its own: it only moves the sequence on to its
 * next index, so reaching it costs one turn and changes nothing else. LIVE-OUT: memory. */

import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";

export function loc_17fb(m) {
  advanceSequenceSubStep(m);
}
