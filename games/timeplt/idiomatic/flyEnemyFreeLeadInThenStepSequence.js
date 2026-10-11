// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyEnemyFreeLeadInThenStepSequence — sequence arm 6: the enemy-free lead-in before a round.
 *
 * ROM 0x5694. Grounding: [seen] (names.js ROUTINES 0x5694).
 *
 * WHAT IT IS. When a round starts, the player gets a short stretch of flight with no enemies: the
 * ship flies and can fire over the era's scenery, but no enemy, object-slot, collision or
 * round-resolution service runs. This arm is that stretch. It runs once per frame and counts the
 * shared sequence delay down; when the delay expires it steps the sequence on into the round engine.
 *
 * ROLE IN THE MACHINE. Entry 6 of the phase-3 sub-step table, between the round-intro caption hold
 * (arm 5, flyRoundIntroFlashingEraYearThenEraseIntroCaptions) and the round engine (arm 7,
 * serviceRoundThenResolvePlayerState, whose service list is a strict superset of this one's). It also
 * runs in the attract demo.
 *
 * ANTI-TAMPER. Both ends of the arm fold a 256-byte program block into SEQUENCE_PHASE (0xA9AB): every
 * frame the block at LEAD_IN_CHECKSUM_BASE (0x0831) closed with XOR 0xC2, and on the expiry frame the
 * block at LEAD_IN_EXPIRY_CHECKSUM_BASE (0x12A7) closed with XOR 0x59. On a genuine image the fold
 * nets out (names.js), leaving the phase as it was; changed program bytes would change the value
 * stored into the sequence machine's outer phase.
 *
 * LIVE-OUT: memory (registers and the dead stack scratch aside).
 */

import { multiplexSpriteSlotsSkipping } from "./multiplexSpriteSlotsSkipping.js";
import { dispatchPlayerFrameByState } from "./dispatchPlayerFrameByState.js";
import { runSceneryForEra } from "./runSceneryForEra.js";
import { fireAndSweepPlayerShots } from "./fireAndSweepPlayerShots.js";
import { multiplexSpriteSlots } from "./multiplexSpriteSlots.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { u8 } from "../../../core/int.js";
import { SEQUENCE_DELAY, SEQUENCE_PHASE, LEAD_IN_CHECKSUM_BASE, LEAD_IN_EXPIRY_CHECKSUM_BASE } from "./names.js";

// The two program blocks folded into the phase.
const FOLD_LENGTH = 256;

/** Subtract every byte of one block from SEQUENCE_PHASE, close with the block's XOR key, store it back. */
function foldIntoPhase(m, base, key) {
  const { mem8 } = m;
  // Eight-bit wrap-around subtraction, byte by byte, starting from the current phase.
  let sum = mem8[SEQUENCE_PHASE];
  for (let i = 0; i < FOLD_LENGTH; i++) sum = u8(sum - mem8[base + i]);
  mem8[SEQUENCE_PHASE] = sum ^ key;
}

export function flyEnemyFreeLeadInThenStepSequence(m) {
  const { mem8 } = m;
  // Every frame: the first anti-tamper fold (block 0x0831, key 0xC2).
  foldIntoPhase(m, LEAD_IN_CHECKSUM_BASE, 0xc2);

  // The player-side services only, in the ROM's order: sprite fixup, the player's frame, sprite
  // fixup again, the era scenery, the player's shots, then the sprite multiplex that lets the
  // scenery slots show twice per frame. No enemy or collision service is called here.
  multiplexSpriteSlotsSkipping(m);
  dispatchPlayerFrameByState(m);
  multiplexSpriteSlotsSkipping(m);
  runSceneryForEra(m);
  fireAndSweepPlayerShots(m);
  multiplexSpriteSlots(m);

  // Count SEQUENCE_DELAY (0xA9EB) down once per call -- no frame-parity gate -- and keep flying
  // while it is still running.
  const delay = u8(mem8[SEQUENCE_DELAY] - 1);
  mem8[SEQUENCE_DELAY] = delay;
  if (delay !== 0) return;

  // Expiry: the second anti-tamper fold (block 0x12A7, key 0x59), then step into the round engine.
  foldIntoPhase(m, LEAD_IN_EXPIRY_CHECKSUM_BASE, 0x59);
  return advanceSequenceSubStep(m);
}
