// SPDX-License-Identifier: GPL-3.0-only
/**
 * flyLifeStartHoldThenEraseLifeStartCaptions — sequence arm 5: the life-start hold.
 *
 * ROM 0x16AF. Grounding: [seen] (names.js ROUTINES 0x16af).
 *
 * WHAT IT IS. At the start of every life, not only a round's first, Time Pilot holds the life-start
 * captions on screen while the ship already flies over the era's scenery with no enemies about. On a
 * round's first life (ROUND_INTRO_PENDING set) the era's year caption (A.D. 1910, 1940, 1970, 1982 or
 * 2001) flashes as well. This arm is one frame of that hold: it flies the ship, repaints the year
 * caption on three frame phases out of sixteen while ROUND_INTRO_PENDING is set, and when the shared
 * sequence delay runs out it erases captions 9 (PLAYER n), 0x0E (STAGE) and 0x1A (the year line),
 * clears ROUND_INTRO_PENDING and steps the sequence on.
 *
 * ROLE IN THE MACHINE. Entry 5 of the phase-3 sub-step table at 0x0F29, between the life-start arm
 * (0x0774, postLifeStartCaptionsAndResetPlayfield) and the enemy-free lead-in (0x5694,
 * flyEnemyFreeLeadInThenStepSequence). Every frame it first folds the 256-byte program block at
 * LIFE_START_HOLD_CHECKSUM_BASE (0x4D9F) into SEQUENCE_PHASE (0xA9AB) -- a subtract-fold closed by XOR
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
import { ERA_INDEX, FRAME_TICK, ROUND_INTRO_PENDING, SEQUENCE_DELAY, SEQUENCE_PHASE, LIFE_START_HOLD_CHECKSUM_BASE } from "./names.js";

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
// Frame-tick low nibble -> command posted while the round's intro is pending; any other nibble posts nothing.
const TICK_COMMANDS = new Map([[0x00, 0x02], [0x05, 0x0a], [0x0a, 0x0b]]);

export function flyLifeStartHoldThenEraseLifeStartCaptions(m) {
  const { mem8 } = m;

  // Anti-tamper fold: subtract each byte of the block from the phase (eight-bit wrap), then XOR 0xA2.
  let fold = mem8[SEQUENCE_PHASE];
  for (let i = 0; i < FOLD_BYTES; i++) fold = u8(fold - mem8[LIFE_START_HOLD_CHECKSUM_BASE + i]);
  mem8[SEQUENCE_PHASE] = fold ^ FOLD_KEY;

  // Fly the ship over the scenery: the player's frame between two sprite fixup passes, then the
  // era scenery, closed by the sprite multiplex. No enemy or collision service runs.
  multiplexSpriteSlotsSkipping(m);
  dispatchPlayerFrameByState(m);
  multiplexSpriteSlotsSkipping(m);
  runSceneryForEra(m);
  multiplexSpriteSlots(m);

  // On odd frames count SEQUENCE_DELAY (0xA9EB) down. When it expires: erase the three life-start
  // captions, clear ROUND_INTRO_PENDING (0xAD0E) -- which stops the flashing below -- re-arm the delay and
  // step the sequence sub-index on to the lead-in.
  const tick = mem8[FRAME_TICK];
  if (tick & 1) {
    const delay = u8(mem8[SEQUENCE_DELAY] - 1);
    mem8[SEQUENCE_DELAY] = delay;
    if (delay === 0) {
      for (const argument of EXPIRY_ARGUMENTS) postCommand(m, EXPIRY_COMMAND, argument);
      mem8[ROUND_INTRO_PENDING] = 0;
      mem8[SEQUENCE_DELAY] = DELAY_REARM;
      return advanceSequenceSubStep(m);
    }
  }

  // The flash: while the round's intro is pending, frame-tick low nibble 0, 5 or 10 repaints the year caption
  // through command 2, 0x0A or 0x0B (names.js: the +0/+5/+10 shared-colour painters), so the
  // caption flashes. Any other nibble posts nothing.
  if (mem8[ROUND_INTRO_PENDING] === 0) return;
  const command = TICK_COMMANDS.get(tick & 0x0f);
  if (command === undefined) return;
  postCommand(m, command, u8(mem8[ERA_INDEX] + ERA_ARGUMENT_BASE));
}
