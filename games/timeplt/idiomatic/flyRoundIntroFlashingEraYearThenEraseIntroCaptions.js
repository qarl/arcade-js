// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyRoundIntroFlashingEraYearThenEraseIntroCaptions — sequence arm 5: the round-intro hold.
 *
 * ROM 0x16AF. Grounding: [seen] (names.js ROUTINES 0x16af).
 *
 * WHAT IT IS. At the start of a round Time Pilot shows its intro captions -- "PLAYER n", "STAGE" and
 * the era's year (A.D. 1910, 1940, 1970, 1982 or 2001) -- while the ship already flies over the era's
 * scenery with no enemies about. The year caption flashes. This arm is one frame of that: it flies
 * the ship, repaints the year caption on three frame phases out of sixteen, and when the shared
 * sequence delay runs out it erases the three captions and steps the sequence on.
 *
 * ROLE IN THE MACHINE. Entry 5 of the phase-3 sub-step table at 0x0F29, between the round-start arm
 * (0x0774, postRoundStartCaptionsAndResetPlayfield) and the enemy-free lead-in (0x5694,
 * flyEnemyFreeLeadInThenStepSequence). Every frame it first folds the 256-byte program block at
 * ROUND_INTRO_CHECKSUM_BASE (0x4D9F) into SEQUENCE_PHASE (0xA9AB) -- a subtract-fold closed by XOR
 * 0xA2, an anti-tamper check that nets out on a genuine image.
 *
 * LIVE-OUT: memory. The one continuation reloads every register it reads.
 */

import { u8 } from "../../../core/int.js";
import { multiplexSpriteSlotsSkipping } from "./multiplexSpriteSlotsSkipping.js";
import { dispatchPlayerFrameByState } from "./dispatchPlayerFrameByState.js";
import { runSceneryForEra } from "./runSceneryForEra.js";
import { multiplexSpriteSlots } from "./multiplexSpriteSlots.js";
import { postCommand } from "./postCommand.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { ERA_INDEX, FRAME_TICK, ROUND_ARMED, SEQUENCE_DELAY, SEQUENCE_PHASE, ROUND_INTRO_CHECKSUM_BASE } from "./names.js";

// The anti-tamper block: 256 program bytes, closed with this XOR key.
const FOLD_BYTES = 256;
const FOLD_KEY = 0xa2;

// On expiry, command 3 erases caption 9 (PLAYER n), 0x0E (STAGE) and 0x1A (the year line).
const EXPIRY_COMMAND = 0x03;
const EXPIRY_ARGUMENTS = [0x09, 0x0e, 0x1a];
// SEQUENCE_DELAY is re-armed with this span for the next arm.
const DELAY_REARM = 0x2a;

// The era's year caption is caption 0x1A + ERA_INDEX.
const ERA_ARGUMENT_BASE = 0x1a;
// Frame-tick low nibble -> command posted while the round is armed; any other nibble posts nothing.
const TICK_COMMANDS = new Map([[0x00, 0x02], [0x05, 0x0a], [0x0a, 0x0b]]);

export function flyRoundIntroFlashingEraYearThenEraseIntroCaptions(m) {
  const { mem8 } = m;

  // Anti-tamper fold: subtract each byte of the block from the phase (eight-bit wrap), then XOR 0xA2.
  let fold = mem8[SEQUENCE_PHASE];
  for (let i = 0; i < FOLD_BYTES; i++) fold = u8(fold - mem8[ROUND_INTRO_CHECKSUM_BASE + i]);
  mem8[SEQUENCE_PHASE] = fold ^ FOLD_KEY;

  // Fly the ship over the scenery: the player's frame and the era scenery between two sprite
  // fixup passes, closed by the sprite multiplex. No enemy or collision service runs.
  multiplexSpriteSlotsSkipping(m);
  dispatchPlayerFrameByState(m);
  multiplexSpriteSlotsSkipping(m);
  runSceneryForEra(m);
  multiplexSpriteSlots(m);

  // On odd frames count SEQUENCE_DELAY (0xA9EB) down. When it expires: erase the three intro
  // captions, clear ROUND_ARMED (0xAD0E) -- which stops the flashing below -- re-arm the delay and
  // step the sequence sub-index on to the lead-in.
  const tick = mem8[FRAME_TICK];
  if (tick & 1) {
    const delay = u8(mem8[SEQUENCE_DELAY] - 1);
    mem8[SEQUENCE_DELAY] = delay;
    if (delay === 0) {
      for (const argument of EXPIRY_ARGUMENTS) postCommand(m, EXPIRY_COMMAND, argument);
      mem8[ROUND_ARMED] = 0;
      mem8[SEQUENCE_DELAY] = DELAY_REARM;
      return advanceSequenceSubStep(m);
    }
  }

  // The flash: while the round is armed, frame-tick low nibble 0, 5 or 10 repaints the year caption
  // through command 2, 0x0A or 0x0B (names.js: the +0/+5/+10 shared-colour painters), so the
  // caption flashes. Any other nibble posts nothing.
  if (mem8[ROUND_ARMED] === 0) return;
  const command = TICK_COMMANDS.get(tick & 0x0f);
  if (command === undefined) return;
  postCommand(m, command, u8(mem8[ERA_INDEX] + ERA_ARGUMENT_BASE));
}
