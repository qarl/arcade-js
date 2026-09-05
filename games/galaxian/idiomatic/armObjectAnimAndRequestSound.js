// SPDX-License-Identifier: GPL-3.0-only
// Entry (sub-state 0) handler of a multi-phase object animation: seeds the animation timers to their
// starting values, advances the sub-state so this entry runs only once, and requests the phase's sound
// effect — picking between two selectors by the object's position byte.
import { loc_41df } from "./names.js";

// Object-record field offsets (bytes from the record base).
const SUBSTATE = 2;
const FRAME_DIVIDER = 16;
const STEP_COUNT = 17;
const STEP_FIELD = 18;
const POS_FIELD = 7;

// Starting values seeded into the timer fields.
const FRAME_DIVIDER_INIT = 4;
const STEP_COUNT_INIT = 4;
const STEP_FIELD_INIT = 28;

// Sound-request selector: position byte below the threshold picks the low effect, at/above it the high.
const POS_THRESHOLD = 112;
const SOUND_REQ_LOW = 0x07;
const SOUND_REQ_HIGH = 0x17;

export function armObjectAnimAndRequestSound(m, obj = m.regs.ix) {
  const { mem8 } = m;

  // Arm the animation timers for this phase.
  mem8[obj + FRAME_DIVIDER] = FRAME_DIVIDER_INIT;
  mem8[obj + STEP_COUNT] = STEP_COUNT_INIT;
  mem8[obj + STEP_FIELD] = STEP_FIELD_INIT;

  // Advance the sub-state so the per-frame animator runs next time.
  mem8[obj + SUBSTATE]++;

  // Request the phase's sound effect, keyed off the object's position byte.
  mem8[loc_41df] =
    mem8[obj + POS_FIELD] >= POS_THRESHOLD ? SOUND_REQ_HIGH : SOUND_REQ_LOW;
}
