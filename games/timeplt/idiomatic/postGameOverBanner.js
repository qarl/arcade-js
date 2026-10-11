// SPDX-License-Identifier: GPL-3.0-only
/** postGameOverBanner — the last life is gone: queue the PLAYER-n caption and then the GAME OVER
 * caption, hold them by arming the sequence countdown, and step the inner sequence index on. The
 * first pair's argument goes up by one while the second player is the one up, which is what picks
 * PLAYER 2 over PLAYER 1.
 * The routine also carries an arm that has nothing to do with a banner: reached with play NOT
 * active, it hands off to restartAttractSequence and never comes back here. That arm has never
 * been seen taken.
 * LIVE-OUT: memory only.
 *
 * ROM 0x1253-0x126E plus the tail `jp 0x0f1a` (frozen lift translated/loc_1253.js, whose span
 * 0x1253-0x1318 also inlines the restartAttractSequence body at 0x12FB). Grounding: [seen]
 * (names.js ROUTINES 0x1253).
 *
 * ROLE IN THE MACHINE. loseLifeAndHandOver branches here (a `jr z` at 0x1214, not a call) when the active player's life count reaches
 * zero. Captions are not drawn here: the main loop's command ring carries (command, argument)
 * pairs to drawing routines run later, and postCommand queues one pair. names.js records, from
 * MAME, that command 2 is drawCaptionInPenColour and command 10 its sibling
 * drawCaptionFivePastSharedColour (colour = PEN_COLOUR + 5), and that arguments 9 / 10 and 11 are caption records PLAYER 1 / PLAYER 2 and
 * GAME OVER. The countdown then holds the banner: SEQUENCE_DELAY is the sequence machine's shared
 * one-shot delay, and the next sub-step counts it down before it files the score.
 *
 * "Never seen taken" for the attract arm is names.js's record of restartAttractSequence: the
 * `jp z` at 0x1257 was never taken under MAME.
 */

import { PLAY_ACTIVE, ACTIVE_PLAYER, SEQUENCE_DELAY } from "./names.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { postCommand } from "./postCommand.js";
import { restartAttractSequence } from "./restartAttractSequence.js";

// The banner's hold: `ld a,0xb4` = 180 frames, the three seconds names.js gives the hold.
const TIMER_RELOAD = 180;

// The two command-ring pairs, loaded as `ld de,0x0209` and `ld de,0x0a0b` (D = command,
// E = argument): command 2 with caption 9 (PLAYER 1, bumped to 10 for PLAYER 2), then command 10
// with caption 11 (GAME OVER).
const FIRST_COMMAND = 2;
const FIRST_ARGUMENT = 9;
const SECOND_COMMAND = 10;
const SECOND_ARGUMENT = 11;

export function postGameOverBanner(m) {
  const { mem8 } = m;

  /* The play-flag test (`ld a,(0xad30) / and a / jp z,0x12fb`). PLAY_ACTIVE is all-ones for a whole
   * credited game and clear otherwise; with it clear the ROM jumps into restartAttractSequence,
   * which returns the machine to the attract sequence, and that routine's `ret` ends this call. */
  if (mem8[PLAY_ACTIVE] === 0) {
    restartAttractSequence(m);
    return;
  }

  /* Queue the two captions (`rst 0x38` twice = postCommand). ACTIVE_PLAYER is 0 for player one,
   * 1 for player two; a nonzero value runs the ROM's `inc e`, turning caption 9 into caption 10. */
  postCommand(m, FIRST_COMMAND, FIRST_ARGUMENT + (mem8[ACTIVE_PLAYER] === 0 ? 0 : 1));
  postCommand(m, SECOND_COMMAND, SECOND_ARGUMENT);

  /* Arm the hold (`ld (0xa9eb),a`) and tail-jump to advanceSequenceSubStep (`jp 0x0f1a`), which
   * steps the inner sequence index on so the countdown step runs next. */
  mem8[SEQUENCE_DELAY] = TIMER_RELOAD;
  advanceSequenceSubStep(m);
}
