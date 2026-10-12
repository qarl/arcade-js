// SPDX-License-Identifier: GPL-3.0-only
/**
 * erasePenRouteThenOpenInitialsEntry — sequence arm 9: erase the pen route, then open the high-score
 * initials entry.
 *
 * ROM 0x08B4. Grounding: [seen] (names.js ROUTINES 0x08b4).
 *
 * WHAT IT IS. After a game ends with a score good enough for the table, the game's "pen" (which
 * stamps one glyph per character cell, run by run, along a route of target cells) is in use on
 * screen. The previous arm (arm 8,
 * fileScoreAfterGameOverHoldElsePassTurn) switched the pen to the blanking glyph 0xF1 and restarted
 * the route, so re-running the route now ERASES it. Once the erase finishes, this arm lays out the
 * initials-entry screen and seats the press histories, letter index, slot count and locked-letter colour the next arm (stepHighScoreInitialsEntry, arm 10) reads
 * as the player dials in three initials.
 *
 * ROLE IN THE MACHINE. Entry 9 of the phase-3 sub-step table at 0x0F29; the sequence machine calls it
 * once per frame until it steps the sub-index on. Each call:
 *   1. runs one leg of the pen route and returns unless the route has reseated to row 0;
 *   2. checks a 256-byte block of the program image (anti-tamper, see below);
 *   3. posts the entry screen's captions and paints the five labelled readouts;
 *   4. clears the control press histories (0xA995-0xA998) and the letter index (0xA999), and sets
 *      INITIALS_SLOTS_LEFT (0xA99A) to 3;
 *   5. stamps letter 0's glyph at the cursor cell held in SCRATCH_PTR_B and saves that cell's colour
 *      into INITIALS_LOCKED_LETTER_COLOUR (0xA990), the colour committed letters are painted in;
 *   6. steps the sequence sub-index.
 *
 * The fold is an anti-tamper check. The block is program image, so on a genuine image it always folds to the
 * same byte and the mismatch arm is dead. On a tampered image the arm jumps into the middle of the vertical-blank service
 * it is itself running under, carrying this arm's live registers into that service's shadow-bank swap: a
 * derail, not a behaviour. There is no faithful transcription of it as a routine, so this arm raises where it
 * would derail instead.
 *
 * LIVE-OUT: memory only.
 */

import { drawInterpolatedPenRun } from "./drawInterpolatedPenRun.js";
import { postCommand } from "./postCommand.js";
import { paintFiveLabelledNumericReadouts } from "./paintFiveLabelledNumericReadouts.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import {
  PEN_ROW_CELL, SCRATCH_PTR_B, INITIALS_ENTRY_CHECKSUM_BASE, INITIALS_LETTER_GLYPH_TABLE,
  INITIALS_LOCKED_LETTER_COLOUR, INITIALS_BACK_PRESS_HISTORY, INITIALS_LETTER_INDEX, INITIALS_SLOTS_LEFT,
} from "./names.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";

// The checked block is the 256 program bytes starting at INITIALS_ENTRY_CHECKSUM_BASE (0x4880).
const CHECKED_BYTES = 256;
// The value the checked block folds to on a genuine image.
const GENUINE_FOLD = 0x30;
// Command 1 with these five arguments lays out the entry screen's captions, posted in this order.
const CAPTION_COMMAND = 1;
const CAPTION_ARGUMENTS = [0x13, 0x00, 0x14, 0x15, 0x0c];
// The cleared run: the four press histories, then the letter index.
const RUN_LENGTH = 5;
// Three initials per entry.
const SLOTS_PER_ENTRY = 3;
// Clearing this address bit turns a tile-plane cell address into its colour-plane twin.
const GLYPH_PLANE_BIT = 0x400;

export function erasePenRouteThenOpenInitialsEntry(m) {
  const { mem8, mem16 } = m;

  // Step 1: one leg of the (blanking) pen route. Until the route reseats to row 0 the erase is
  // still under way, so come back next frame.
  // The pen run leaves the return to the dispatch, so the early exit owes none of its own.
  drawInterpolatedPenRun(m);
  if (mem8[PEN_ROW_CELL] !== 0) return;

  // Step 2: XOR-fold the checked program block. A genuine image always folds to 0x30.
  let fold = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) fold ^= mem8[INITIALS_ENTRY_CHECKSUM_BASE + i];
  if (fold !== GENUINE_FOLD) {
    throw new NotImplemented(
      "erasePenRouteThenOpenInitialsEntry: the program-block fold reached its tamper derail; a genuine image always folds to the expected byte",
    );
  }

  // Step 3: queue the entry screen's captions in the command ring and paint the five labelled
  // numeric readouts.
  for (const argument of CAPTION_ARGUMENTS) postCommand(m, CAPTION_COMMAND, argument);
  paintFiveLabelledNumericReadouts(m);

  // Step 4: start the entry clean -- no remembered presses, letter 0 (A) showing, three slots to fill.
  for (let i = 0; i < RUN_LENGTH; i++) mem8[INITIALS_BACK_PRESS_HISTORY + i] = 0;
  mem8[INITIALS_SLOTS_LEFT] = SLOTS_PER_ENTRY;

  // Step 5: draw the current letter's glyph (ROM table 0x12C7) at the cursor cell, and remember the
  // colour already on that cell's colour-plane byte; each initial is repainted in it as it locks.
  const cell = mem16[SCRATCH_PTR_B];
  mem8[cell] = fetchTableByte(m, INITIALS_LETTER_GLYPH_TABLE, mem8[INITIALS_LETTER_INDEX]);
  mem8[INITIALS_LOCKED_LETTER_COLOUR] = mem8[cell & ~GLYPH_PLANE_BIT];

  // Step 6: on to arm 10, the per-frame initials entry.
  return advanceSequenceSubStep(m);
}
