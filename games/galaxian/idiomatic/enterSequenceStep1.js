// SPDX-License-Identifier: GPL-3.0-only
// Sequence-state handler: hand the state machine on to step 1 and seed a short
// dwell timer (3 frame-ticks, 3 second-ticks) for step 1 to count down.
import { SEQUENCE_STATE, loc_4008, loc_4009 } from "./names.js";

// The dwell seeded for step 1: 3 frame-ticks and 3 second-ticks.
const DWELL_FRAMES = 3;
const DWELL_TICKS = 3;

export function enterSequenceStep1(m) {
  const { mem8 } = m;

  // Advance the sequence to step 1.
  mem8[SEQUENCE_STATE] = 1;

  // Arm the dwell timer step 1 counts down.
  mem8[loc_4008] = DWELL_FRAMES;
  mem8[loc_4009] = DWELL_TICKS;
}
