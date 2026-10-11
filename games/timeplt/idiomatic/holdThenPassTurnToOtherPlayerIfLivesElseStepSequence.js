// SPDX-License-Identifier: GPL-3.0-only
/**
 * holdThenPassTurnToOtherPlayerIfLivesElseStepSequence — run the sequence delay down by one and, on the frame it reaches zero and only then, let the
 * sequence take its next decision.
 *
 * WHAT IT IS: ROM 0x12E2-0x12FA, tag [seen] (names.js ROUTINES 0x12e2). It is arm 11 of the phase-3
 * sub-step jump table at 0x0F29: the sequence machine dispatches it each time it services that
 * sub-step.
 *
 * WHY THIS NAME: the prologue `ld hl,0xA9EB / dec (hl)` is an idiom the image reuses at seven places
 * (0x12E2, 0x16D6, 0x174E, 0x1792, 0x196A, 0x330B, 0x56B8), two of them arms of this same table, so the
 * hold alone does not tell them apart; this entry is named by the tail it takes,
 * passTurnToOtherPlayerIfLivesElseStepSequence, as its arm-8 sibling fileScoreAfterGameOverHoldElsePassTurn is.
 *
 * The countdown wraps rather than sticking, so a delay that starts at zero buys a full 256 frames before
 * the decision comes round again. On every other frame the one decremented cell is the whole effect.
 *
 * LIVE-OUT: memory-only.
 */

import { u8 } from "../../../core/int.js";
import { passTurnToOtherPlayerIfLivesElseStepSequence } from "./passTurnToOtherPlayerIfLivesElseStepSequence.js";
import { SEQUENCE_DELAY } from "./names.js";

export function holdThenPassTurnToOtherPlayerIfLivesElseStepSequence(m) {
  const { mem8 } = m;
  /*
   * Count SEQUENCE_DELAY (0xA9EB, the one delay cell every sequence arm shares) down by one, wrapping
   * at the byte as the Z80's `dec (hl)` does. While it is still running, return (`ret nz`): this frame's
   * work is done.
   */
  const remaining = u8(mem8[SEQUENCE_DELAY] - 1);
  mem8[SEQUENCE_DELAY] = remaining;
  if (remaining !== 0) return;
  /*
   * Expired: fall through into 0x12E7, which hands the turn to the other player when that player
   * still has lives and otherwise steps the inner sequence index on.
   */
  passTurnToOtherPlayerIfLivesElseStepSequence(m);
}
