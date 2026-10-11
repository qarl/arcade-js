// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceSequenceSubStep — step the sequence machine's inner index on by one.
 *
 * ROM 0x0F1A-0x0F1E (loc_0f1a). Grounding: [seen] (names.js ROUTINES 0x0F1A).
 *
 * What it is: the "next step" move of the two-level sequence machine. SEQUENCE_SUBSTEP (0xA9AC)
 * [seen] is the INNER index: each mode's dispatcher reads it (the round engine masks it to its low
 * nibble) and jumps through a word table to the arm it selects. An arm that has finished its job
 * comes here so that the next frame's dispatch runs the following arm.
 *
 * Role in the machine: most callers reach it as a tail jump, so the caller's own return is carried by
 * this one; a few (at 0x076E, 0x1864 and 0x3393) also call it just before that jump, so on that path
 * the index steps twice. It is the inner half of the pair whose outer half is advanceSequencePhase, which
 * steps the phase and zeroes this index in one breath — so this step is the one that gets
 * discarded whenever the sequence really changes mode.
 *
 * It clamps nothing, masks nothing, branches nowhere and returns nothing.
 *
 * LIVE-OUT: SEQUENCE_SUBSTEP alone.
 */

import { SEQUENCE_SUBSTEP } from "./names.js";

export function advanceSequenceSubStep(m) {
  const { mem8 } = m;
  // The ROM's `ld hl,0xa9ac / inc (hl)`: read the index, add one, store it back. The byte store
  // truncates to eight bits, so 255 wraps to 0 just as the hardware increment does.
  const step = mem8[SEQUENCE_SUBSTEP];
  mem8[SEQUENCE_SUBSTEP] = step + 1;
}
