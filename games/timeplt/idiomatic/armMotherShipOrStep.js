// SPDX-License-Identifier: GPL-3.0-only
/**
 * armMotherShipOrStep — the once-in-eight-frames gate for the Mother-Ship.
 *
 * ROM 0x43B7-0x43E7. Grounding: [seen] (names.js ROUTINES 0x43b7).
 *
 * WHAT IT IS. Every era of Time Pilot ends with a Mother-Ship: once the player has destroyed the
 * era's kill quota (KILLS_REMAINING 0xAD02, the manual's 56), the big ship appears; it absorbs
 * seven hits and the eighth destroys it. This routine decides, pass by pass, whether the
 * Mother-Ship is already on the field (in which case its own state machine runs) or whether it is
 * time to bring it on.
 *
 * ROLE IN THE MACHINE. Called once per dispatch of the round engine's service list
 * (serviceRoundThenResolvePlayerState, phase-3 sub-step 7). It does nothing at all while
 * ROUND_TRANSITION_HOLD (0xACC6) reads 0xFF. Otherwise, while the Mother-Ship is armed it simply hands the pass to loc_43f0 (ROM 0x43F0). Otherwise it arms the Mother-Ship
 * at most once every eight frames, and only when the quota is spent and its two-slot record bank
 * (MOTHER_SHIP_STATE 0xA8A0 and the record one stride on, 0xA8B0) is empty. Arming raises
 * MOTHER_SHIP_ARMED (0xAD0D), seeds the lead record's hit counter with seven, and retires the record
 * and its sprite-entry pair (MOTHER_SHIP_ENTRY 0xAA24) into a cooldown, from which the Mother-Ship's
 * stepper launches it.
 *
 * LIVE-OUT: memory.
 */

import { retireEntryPairIntoCooldown } from "./retireEntryPairIntoCooldown.js";
import { loc_43f0 } from "./loc_43f0.js";
import {
  CRAFT_RECORD_SLOT6,
  FRAME_TICK,
  KILLS_REMAINING,
  MOTHER_SHIP_ARMED,
  MOTHER_SHIP_ENTRY,
  MOTHER_SHIP_HITS_TO_ABSORB,
  MOTHER_SHIP_STATE,
  ROUND_TRANSITION_HOLD,
} from "./names.js";

// The all-ones value: a transition hold of 0xFF, and the "armed" value of MOTHER_SHIP_ARMED.
const HELD = 0xff;
// FRAME_TICK & 7 == 5 is this routine's one frame in eight.
const PHASE_MASK = 0x07;
const PHASE_DUE = 0x05;
// The Mother-Ship takes seven hits.
const HITS_WHEN_ARMED = 0x07;

export function armMotherShipOrStep(m) {
  const { mem8 } = m;

  // Stand down entirely while ROUND_TRANSITION_HOLD (0xACC6) reads 0xFF -- the value the
  // Mother-Ship's warp/flash finish leaves while the round hands over. The ROM tests it with
  // `inc a / ret z`, so only 0xFF stops it; the 0xFE the field sweep writes does not.
  if (mem8[ROUND_TRANSITION_HOLD] === HELD) return;

  // Already armed: the Mother-Ship is on the field (or on its way), so its own deep state
  // machine runs every pass. This is a tail transfer to ROM 0x43F0.
  if (mem8[MOTHER_SHIP_ARMED] !== 0) return loc_43f0(m);

  // Not armed: consider arming only on one frame in eight (frame-tick phase 5).
  if ((mem8[FRAME_TICK] & PHASE_MASK) !== PHASE_DUE) return;

  // Arm only when the kill quota is spent AND both records of the two-slot bank are free (the second
  // record is slot 6's, CRAFT_RECORD_SLOT6). The ROM ORs the three bytes together and returns on any
  // nonzero bit, so a single nonzero one blocks it.
  if ((mem8[KILLS_REMAINING] | mem8[MOTHER_SHIP_STATE] | mem8[CRAFT_RECORD_SLOT6]) !== 0) return;

  // Arm it: raise the armed flag, give the lead record its seven hits, then tail into the
  // entry-pair retire (ROM 0x46DB), which zeroes the record's head byte and both sprite entries' X and Y
  // and arms the record's delay (+0x0E = 0x5F) -- the cooldown after which loc_43f0 launches it.
  mem8[MOTHER_SHIP_ARMED] = HELD;
  mem8[MOTHER_SHIP_HITS_TO_ABSORB] = HITS_WHEN_ARMED;
  return retireEntryPairIntoCooldown(m, MOTHER_SHIP_STATE, MOTHER_SHIP_ENTRY);
}
