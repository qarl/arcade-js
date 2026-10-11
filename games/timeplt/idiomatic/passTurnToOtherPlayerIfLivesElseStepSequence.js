// SPDX-License-Identifier: GPL-3.0-only
/** passTurnToOtherPlayerIfLivesElseStepSequence — decide whether the turn passes to the other player or the sequence simply steps on.
 * The active-player index picks the OTHER player's saved lives count, and a non-zero count is the
 * whole condition: somebody else is still in the game, so the turn is handed over. A zero count
 * ends the choice and the inner sequence index advances by one instead. This file writes no cell
 * of its own.
 *
 * ROM 0x12E7-0x12FA (frozen lift translated/loc_12e7.js). Grounding: [seen] (names.js ROUTINES 0x12E7).
 *
 * Role in the machine: the fork at the end of a player's game. Every path out of game over, apart
 * from a new game started during initials entry, ends here (mechanisms.md) — its callers are
 * fileScoreAfterGameOverHoldElsePassTurn and holdThenPassTurnToOtherPlayerIfLivesElseStepSequence. Both exits are TAIL jumps, so this entry
 * chooses between two continuations rather than returning to anything:
 *  - handPlayOverToOtherPlayer (0x1226) flips ACTIVE_PLAYER, re-arms the sequence delay and reseats
 *    the sub-step, so the surviving player plays on with their own progress intact;
 *  - advanceSequenceSubStep (0x0F1A) just moves the sequence on to its next step.
 * In a one-player game the other player's count is zero from the start, so the hand-over is never
 * taken there.
 *
 * Each player's context is saved in a 16-byte block — player one's at 0xAD10, player two's at
 * 0xAD20 — and the lives count is the first byte of each (PLAYER_ONE_LIVES, PLAYER_TWO_LIVES).
 *
 * LIVE-OUT: memory-only. */

import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { handPlayOverToOtherPlayer } from "./handPlayOverToOtherPlayer.js";
import { ACTIVE_PLAYER, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES } from "./names.js";

// ACTIVE_PLAYER holds 0 while player one is up (its polarity is grounded in names.js).
const FIRST = 0;

export function passTurnToOtherPlayerIfLivesElseStepSequence(m) {
  const { mem8 } = m;
  // ROM `ld a,(0xad32) / and a / ld hl,0xad20 / jr z` (else `ld hl,0xad10`): with player one active
  // the OTHER player is player two, so read PLAYER_TWO_LIVES; otherwise read PLAYER_ONE_LIVES.
  const otherPlayerLives = mem8[ACTIVE_PLAYER] === FIRST ? PLAYER_TWO_LIVES : PLAYER_ONE_LIVES;
  // ROM `ld a,(hl) / and a / jp nz,0x1226`: lives left over there — hand the turn across.
  if (mem8[otherPlayerLives] !== 0) return handPlayOverToOtherPlayer(m);
  // ROM `jp 0x0f1a`: nobody else to play — step the sequence on.
  advanceSequenceSubStep(m);
}
