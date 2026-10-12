// SPDX-License-Identifier: GPL-3.0-only
/** postLifeStartCaptionsAndResetPlayfield — life-start sequence arm: verify a fixed program span, post the pre-life caption
 * commands, repaint the kill meter, reset the playfield for the coming life, and step the sequence
 * sub-index.
 * The span is XOR-folded; any total but the genuine one advances the outer sequence phase first.
 * With play inactive a single default caption pair is posted. With play active the player caption
 * goes up (its argument one higher while the second player is up), followed by the same argument
 * under a second command while the round's intro is pending, else by the default pair.
 * LIVE-OUT: memory only. */

/*
 * ROM 0x0774-0x07AC, grounding [seen] (names.js ROUTINES 0x0774).
 *
 * ROLE. The game is run by a two-level sequence machine: an outer phase (SEQUENCE_PHASE) and an inner
 * sub-step (SEQUENCE_SUBSTEP) that indexes a word table of "arms". This is entry 4 of the phase-3
 * (round engine) table at 0x0F29: the one-frame arm that opens every life, a round's first and each
 * restart after a lost life -- in real play and in the attract demo alike. It posts the captions shown
 * before the life begins (in a game, the round-number caption only on a round's first life), repaints the kill meter,
 * resets the whole playfield, and steps the sub-step so the next frame runs the next arm.
 *
 * CAPTIONS. Text is not drawn here: postCommand (RST 0x38, 0x0038) queues a (command, argument) pair
 * in the command ring and the ring is drawn later, outside the interrupt. Command 2 is
 * drawCaptionInPenColour and command 7 drawRoundNumberCaption (command table 0x0BBC); caption records
 * 2, 9 and 10 in the 0x0C50 table read as " READY ", "PLAYER 1" and "PLAYER 2" (the glyph text is a
 * code-level reading, per names.js).
 */

import { advanceSequencePhase } from "./advanceSequencePhase.js";
import { postCommand } from "./postCommand.js";
import { drawKillMeter } from "./drawKillMeter.js";
import { resetPlayfieldForLifeStart } from "./resetPlayfieldForLifeStart.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { PLAY_ACTIVE, ACTIVE_PLAYER, ROUND_INTRO_PENDING, LIFE_START_CAPTIONS_CHECKSUM_BASE } from "./names.js";

// Anti-tamper guard: the XOR of 256 program bytes must be 0x6B. (The ROM tests it as
// `add a,0x95`, which is zero exactly when the fold is 0x6B.)
const GUARD_SPAN_BYTES = 256;
const GUARD_GENUINE_FOLD = 0x6b;

// Command-ring pairs: command 2 draws a caption (argument = caption record), command 7 draws the
// round-number caption. Caption 2 is " READY ", caption 9 "PLAYER 1" (10 is "PLAYER 2").
const CAPTION_COMMAND = 2;
const DEFAULT_ARGUMENT = 2;
const PLAYER_ARGUMENT = 9;
const ROUND_NUMBER_CAPTION_COMMAND = 7;

export function postLifeStartCaptionsAndResetPlayfield(m) {
  const { mem8 } = m;

  // Anti-tamper guard. XOR-fold the 256 bytes at LIFE_START_CAPTIONS_CHECKSUM_BASE (0x4C99, [seen]). A
  // modified image folds to something else, and then advanceSequencePhase (0x0F11) throws the
  // outer phase forward (and restarts its sub-step). On a genuine image the fold
  // is 0x6B and nothing happens; the rest of the arm runs either way.
  let fold = 0;
  for (let i = 0; i < GUARD_SPAN_BYTES; i++) fold ^= mem8[LIFE_START_CAPTIONS_CHECKSUM_BASE + i];
  if (fold !== GUARD_GENUINE_FOLD) advanceSequencePhase(m);

  // Captions. PLAY_ACTIVE (0xAD30, [seen]) is what separates a credited game from the attract
  // demo. In the demo only " READY " is posted.
  if (mem8[PLAY_ACTIVE] === 0) {
    postCommand(m, CAPTION_COMMAND, DEFAULT_ARGUMENT);
  } else {
    // In a game: "PLAYER 1" or "PLAYER 2" by ACTIVE_PLAYER (0xAD32, [seen]; 0 = first player).
    // The ROM loads the pair from the program word at 0x125B and bumps its argument byte by one
    // (`inc e`) for the second player.
    const argument = PLAYER_ARGUMENT + (mem8[ACTIVE_PLAYER] === 0 ? 0 : 1);
    postCommand(m, CAPTION_COMMAND, argument);
    // Then, if ROUND_INTRO_PENDING (0xAD0E, [seen]) is clear, " READY " again; if it is set, the same
    // argument re-posted under command 7 (drawRoundNumberCaption) -- the ROM just swaps the
    // command byte (`ld d,0x07`) and posts again.
    if (mem8[ROUND_INTRO_PENDING] === 0) postCommand(m, CAPTION_COMMAND, DEFAULT_ARGUMENT);
    else postCommand(m, ROUND_NUMBER_CAPTION_COMMAND, argument);
  }

  // Repaint the kill meter (drawKillMeter, 0x0809), reset the playfield and load the era-and-rung
  // settings (resetPlayfieldForLifeStart, 0x19F0), then step the inner sequence index
  // (advanceSequenceSubStep, 0x0F1A, a ROM tail jump) so the next frame runs the next arm.
  drawKillMeter(m);
  resetPlayfieldForLifeStart(m);
  advanceSequenceSubStep(m);
}
