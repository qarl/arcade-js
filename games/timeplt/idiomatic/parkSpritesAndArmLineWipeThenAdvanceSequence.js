// SPDX-License-Identifier: GPL-3.0-only
/** parkSpritesAndArmLineWipeThenAdvanceSequence — one step of a screen-clearing sequence. Every sprite is parked out of sight; the
 * glyph and colour showing at one fixed character cell are copied into one fixed two-byte record;
 * the line wipe is armed to run from the plane's fifth line; and the sequence's inner index is
 * stepped on, which is the last thing done. Both the cell and the record are fixed here, so
 * nothing a caller was holding chooses either.
 *
 * ROM 0x181E-0x182F (frozen lift translated/loc_181e.js): three calls (0x15B6, 0x1AFC, 0x01B5) and a
 * tail jump to 0x0F1A. Grounding: [seen] (names.js ROUTINES 0x181E).
 *
 * Role in the machine: step 0 of sequence phase 2 — "a credit on the board, waiting for start" —
 * run through dispatchSequencePhase2SubStepArm. Phase 2 is only ever entered with a credit banked,
 * and this first step clears the stage for the push-start information screen: the sprites vanish at
 * once, and the character plane is then blanked one line per frame by the NEXT step
 * (blankOneLineThenGuardBlockOrDerailSequence), which consumes the wipe armed here (mechanisms.md,
 * "Phase 2").
 *
 * LIVE-OUT: memory. */

import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { armLineWipeFromFifthLine } from "./armLineWipeFromFifthLine.js";
import { hideAllSprites } from "./hideAllSprites.js";
import { sampleCellGlyphAndColour } from "./sampleCellGlyphAndColour.js";
import { LINE_WIPE_SAMPLED_CELL, LINE_WIPE_SAMPLE_RECORD } from "./names.js";

// The ROM's `ld hl,0xa5fc` / `ld de,0xacbe`: the character cell sampled, and the record it goes into.
const SAMPLED_CELL = LINE_WIPE_SAMPLED_CELL;
const SAMPLE_RECORD = LINE_WIPE_SAMPLE_RECORD;

export function parkSpritesAndArmLineWipeThenAdvanceSequence(m) {
  // `call 0x15b6`: zero the native-Y byte of all 24 sprite entries in the sprite shadow, which puts
  // every sprite off the visible picture — out of sight from the next frame's publish.
  hideAllSprites(m);
  // `call 0x1afc`: copy the glyph at 0xA5FC and that cell's colour into the two bytes at 0xACBE.
  // The cell is only read; nothing on screen changes here.
  sampleCellGlyphAndColour(m, SAMPLED_CELL, SAMPLE_RECORD);
  // `call 0x01b5`: point the line-wipe cursor at the plane's fifth line (0xA404) and load its line
  // count from the program byte at 0x0CCD (27). Nothing is blanked yet; the next step does that.
  armLineWipeFromFifthLine(m);
  // `jp 0x0f1a`: step SEQUENCE_SUBSTEP on so the next frame dispatches step 1 — a tail jump, so its
  // return is this step's return.
  advanceSequenceSubStep(m);
}
