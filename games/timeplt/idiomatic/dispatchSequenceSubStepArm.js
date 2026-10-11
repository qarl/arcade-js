// SPDX-License-Identifier: GPL-3.0-only
/** dispatchSequenceSubStepArm — inner level of the two-level sequence machine for the round-engine
 * mode: the low nibble of the sub-step picks one of sixteen arms out of a fixed inline word table,
 * that arm runs, then the fixed continuation every arm returns into. Each case is the slot's literal
 * target, called directly; the nibble mask means every sub-step value lands on one of the sixteen slots and
 * every one names a transcribed arm, so no index can fall off the table. No arm reads a register the
 * dispatch would have left standing — each opens on a cell read or a fixed-argument call — so the arm
 * is entered directly, with no return slot parked for it and no table word carried in on a register
 * pair. LIVE-OUT: memory, and the continuation's.
 *
 * ROM 0x0F1F-0x0F28; the sixteen-word arm table sits inline at 0x0F29
 * (PHASE3_SUBSTEP_DISPATCH_TABLE). [seen]
 *
 * Role in the machine: Time Pilot's frame-by-frame behaviour is a two-level state machine. The outer
 * level, SEQUENCE_PHASE (0xA9AB), is the machine's mode -- 0 boot wipe, 1 attract, 2 credit / push
 * start, 3 round engine -- and the frame service picks one handler per mode. This file is the handler
 * for phase 3. The inner level, SEQUENCE_SUBSTEP (0xA9AC), says where in the round's life the machine
 * is: each arm does its step for this frame and, when its step is finished, advances the sub-step so
 * the next frame runs the next arm. Phase 3 is used by both real play and the attract demo.
 *
 * In the ROM: `ld hl,0x0f54 / push hl` parks advanceAttractTowardGameStart as the address every arm
 * returns to, then `rst 0x30` indexes the inline table with the sub-step's low nibble.
 */

import { SEQUENCE_SUBSTEP } from "./names.js";
import { advanceAttractTowardGameStart } from "./advanceAttractTowardGameStart.js";
import { armRoundStartThenStepSequence } from "./armRoundStartThenStepSequence.js";
import { seatCaptionPenFromEraFoldingTamperIntoPhase } from "./seatCaptionPenFromEraFoldingTamperIntoPhase.js";
import { blankCaptionThenAdvancePenRunStep } from "./blankCaptionThenAdvancePenRunStep.js";
import { loadActivePlayerContextAndPostRoundHud } from "./loadActivePlayerContextAndPostRoundHud.js";
import { postRoundStartCaptionsAndResetPlayfield } from "./postRoundStartCaptionsAndResetPlayfield.js";
import { flyRoundIntroFlashingEraYearThenEraseIntroCaptions } from "./flyRoundIntroFlashingEraYearThenEraseIntroCaptions.js";
import { flyEnemyFreeLeadInThenStepSequence } from "./flyEnemyFreeLeadInThenStepSequence.js";
import { serviceRoundThenResolvePlayerState } from "./serviceRoundThenResolvePlayerState.js";
import { fileScoreAfterGameOverHoldElsePassTurn } from "./fileScoreAfterGameOverHoldElsePassTurn.js";
import { erasePenRouteThenOpenInitialsEntry } from "./erasePenRouteThenOpenInitialsEntry.js";
import { stepHighScoreInitialsEntry } from "./stepHighScoreInitialsEntry.js";
import { holdThenPassTurnToOtherPlayerIfLivesElseStepSequence } from "./holdThenPassTurnToOtherPlayerIfLivesElseStepSequence.js";
import { restartAttractSequence } from "./restartAttractSequence.js";
import { armRoundWonBandAnimationThenStepSequence } from "./armRoundWonBandAnimationThenStepSequence.js";
import { stepRoundStartIntroAnimation } from "./stepRoundStartIntroAnimation.js";
import { loc_15b5 } from "./loc_15b5.js";

// Only the low nibble picks a slot, so the table's sixteen words are the whole of the choice.
const ARM_MASK = 0x0f;

export function dispatchSequenceSubStepArm(m) {
  // Select this frame's arm from the sub-step's low nibble and run it.
  switch (m.mem8[SEQUENCE_SUBSTEP] & ARM_MASK) {
    // The round-start arm, the caption pen seated from the era, the caption blank and pen-run step,
    // the active player's turn set up with the round HUD, the round-start captions, the flashing era
    // year, the enemy-free lead-in, then the round engine itself; after it the post-game-over filing,
    // the pen-route erase that opens initials entry, the initials entry step, a delay countdown, the
    // attract restart, the arm that sets up the round-won band animation, that animation's per-frame
    // step, and an arm that does nothing.
    //
    // Arms 0-7: getting a round going, up to and including the round engine (arm 7), which runs the
    // game's subsystem services in a fixed order and then reads the player's state.
    case 0: armRoundStartThenStepSequence(m); break;
    case 1: seatCaptionPenFromEraFoldingTamperIntoPhase(m); break;
    case 2: blankCaptionThenAdvancePenRunStep(m); break;
    case 3: loadActivePlayerContextAndPostRoundHud(m); break;
    case 4: postRoundStartCaptionsAndResetPlayfield(m); break;
    case 5: flyRoundIntroFlashingEraYearThenEraseIntroCaptions(m); break;
    case 6: flyEnemyFreeLeadInThenStepSequence(m); break;
    case 7: serviceRoundThenResolvePlayerState(m); break;
    // Arms 8-10: the end of a game -- the GAME OVER hold that then files the score, the pen-route
    // erase that opens initials entry, and the per-frame initials entry.
    case 8: fileScoreAfterGameOverHoldElsePassTurn(m); break;
    case 9: erasePenRouteThenOpenInitialsEntry(m); break;
    case 10: stepHighScoreInitialsEntry(m); break;
    // Arms 11-14: a delay countdown, the attract restart, and the round-won band animation (arm 13
    // sets it up, arm 14 runs it frame by frame).
    case 11: holdThenPassTurnToOtherPlayerIfLivesElseStepSequence(m); break; // the delay countdown (SEQUENCE_DELAY), then the turn hand-over
    case 12: restartAttractSequence(m); break;
    case 13: armRoundWonBandAnimationThenStepSequence(m); break;
    case 14: stepRoundStartIntroAnimation(m); break;
    // Slot 15 is a lone `ret` (names.js: unreachable filler, [code]); arm 14 overwrites the sub-step
    // in the same interrupt it steps it to 15, so no dispatch reads 15.
    case 15: loc_15b5(m); break;
  }
  // Every arm returns into 0x0F54: the continuation that, outside play, watches for credits (and on
  // free play a held start button) to move the machine toward starting a game.
  advanceAttractTowardGameStart(m);
}
