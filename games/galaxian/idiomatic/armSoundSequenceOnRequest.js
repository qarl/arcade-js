// SPDX-License-Identifier: GPL-3.0-only
// One-shot arm of a sound sequence, gated on a request byte: fires only when the gate holds 1, then
// clears the gate, raises this track's active flag and its companion, and points the sequence-data
// pointer at this sequence's table. Any other gate value is a no-op, leaving the byte untouched.
import { loc_41d1, loc_41d2, loc_41d6, SOUND_SEQ_PTR, loc_1e68 } from "./names.js";

// The one value the request gate must hold for the sequence to arm.
const ARM_REQUESTED = 1;

export function armSoundSequenceOnRequest(m) {
  const { mem8, mem16 } = m;

  // Gate: arm only on an outstanding request; any other value returns untouched.
  if (mem8[loc_41d1] !== ARM_REQUESTED) return;

  // Consume the request and arm: raise the active flag and its companion, publish the data pointer.
  mem8[loc_41d1] = 0;
  mem8[loc_41d2] = 1;
  mem8[loc_41d6] = 1;
  mem16[SOUND_SEQ_PTR] = loc_1e68;
}
