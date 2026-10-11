// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceScriptedCharPlaneBandTo4 — one frame of the SECOND scripted character-plane band in the
 * between-eras band animation a won round plays; when its script runs out it hands the animation on
 * to step 4.
 *
 * ROM 0x14C5-0x1562. Grounding: [seen] (names.js ROUTINES 0x14C5).
 *
 * ROLE IN THE MACHINE. After a round is won, armRoundWonBandAnimationThenStepSequence stocks the
 * animation's control block at ROUND_WON_ANIMATION_STEP (0xA9F0) [seen], and stepRoundWonBandAnimation
 * (sequence sub-step 14) dispatches on that step byte. Steps 2 and 3 run this routine (step 2 alongside
 * the player-ship colour cycle). The "band" is a column of character cells centred on the player's jet
 * (names.js: the CHAR_PLANE_STUB_* cells are the warp-band flare corners around the jet's centre column,
 * observed under MAME on the rotated screen) that a script animates one pass at a time.
 *
 * TWO ALTERNATING PASSES, chosen by bit 0 of BAND_TO4_PASS_COUNTDOWN (0xA9F4) [seen], which is
 * decremented at the end of each pass so the bit flips every call:
 *   - BLANKING (bit 0 clear): overwrite the band with the blank tile 0xF1, clearing last pass's picture;
 *   - DRAWING (bit 0 set): lay the saved column back, step its shapes as the script says, and gather the
 *     result back into the saved run for the next drawing pass.
 * The script is read through BAND_SCRIPT_CURSOR (0xA9F7) [seen], a 16-bit cursor shared with the first
 * band (advanceScriptedCharPlaneBandTo2) and stepThirteenScriptedGlyphCells, left wherever it ended.
 *
 * END OF SCRIPT. A drawing pass whose current script byte has any bit above bit 0 set (ROM `and 0xfe`)
 * is the terminator: it zeroes the countdown, sets ROUND_WON_ANIMATION_STEP to 4, asks for the inter-round
 * sound pair, steps the cursor up one byte off the terminator (this half reads the script downward)
 * and returns WITHOUT the final decrement.
 *
 * LIVE-OUT: memory-only (the caller returns the instant this does).
 */

import { u8, u16 } from "../../../core/int.js";
import { fillCellRun } from "./fillCellRun.js";
import { restoreColumnFromSavedRun } from "./restoreColumnFromSavedRun.js";
import { requestInterRoundSoundPair } from "./requestInterRoundSoundPair.js";
import { stepThirteenScriptedGlyphCells } from "./stepThirteenScriptedGlyphCells.js";
import { gatherCharColumnIntoBackingRun } from "./gatherCharColumnIntoBackingRun.js";
import {
  BAND_SCRIPT_CURSOR,
  BAND_TO4_PASS_COUNTDOWN,
  ROUND_WON_ANIMATION_STEP,
  CHAR_PLANE_COLUMN_BASE,
  CHAR_PLANE_UPPER_RUN_BOTTOM,
  CHAR_PLANE_STUB_UPPER_RIGHT,
  CHAR_PLANE_COLUMN_MID_TOP,
  CHAR_PLANE_STUB_LOWER_RIGHT,
  CHAR_PLANE_STUB_UPPER_LEFT,
  CHAR_PLANE_COLUMN_MID_BOTTOM,
  CHAR_PLANE_STUB_LOWER_LEFT,
  CHAR_PLANE_LOWER_RUN_BOTTOM,
} from "./names.js";

/** The animation step handed on to when the script ends (ROM `ld a,0x04; ld (0xa9f0),a`). */
const NEXT_STEP = 0x04;
/** The blank tile code the blanking pass writes (ROM `ld a,0xf1`). */
const FILL = 0xf1;
/** Script bytes consumed by one thirteen-cell step (ROM `ld de,0x000d; add hl,de`). */
const SCRIPT_STRIDE = 13;

export function advanceScriptedCharPlaneBandTo4(m) {
  const { mem8, mem16 } = m;

  // BLANKING PASS (ROM: `bit 0,a` on 0xA9F4). Two thirteen-cell runs of the working column — the lower
  // run up from 0xA7B1 and the upper run up from 0xA5D1 — go blank through fillCellRun (ROM 0x1319),
  // then the six lead cells around the column centre: the four flare-corner stubs (0xA5F0/0xA5F2 and
  // 0xA610/0xA612) and the two column-centre cells (0xA5F1/0xA611).
  if ((mem8[BAND_TO4_PASS_COUNTDOWN] & 1) === 0) {
    fillCellRun(m, FILL, CHAR_PLANE_LOWER_RUN_BOTTOM);
    fillCellRun(m, FILL, CHAR_PLANE_UPPER_RUN_BOTTOM);
    mem8[CHAR_PLANE_STUB_UPPER_LEFT] = FILL;
    mem8[CHAR_PLANE_STUB_UPPER_RIGHT] = FILL;
    mem8[CHAR_PLANE_COLUMN_MID_BOTTOM] = FILL;
    mem8[CHAR_PLANE_COLUMN_MID_TOP] = FILL;
    mem8[CHAR_PLANE_STUB_LOWER_LEFT] = FILL;
    mem8[CHAR_PLANE_STUB_LOWER_RIGHT] = FILL;
  } else {
    // DRAWING PASS. First the terminator test on the byte under the cursor: script bytes that carry
    // pass data only use bit 0, so any higher bit marks the end of this band's script.
    if ((mem8[mem16[BAND_SCRIPT_CURSOR]] & 0xfe) !== 0) {
      mem8[BAND_TO4_PASS_COUNTDOWN] = 0;
      mem8[ROUND_WON_ANIMATION_STEP] = NEXT_STEP;
      requestInterRoundSoundPair(m);
      mem16[BAND_SCRIPT_CURSOR] = u16(mem16[BAND_SCRIPT_CURSOR] + 1);
      return;
    }
    // Lay the saved thirty-two-cell picture back onto the character plane (ROM 0x1563): the column's
    // twenty-eight cells plus the two two-cell stub columns beside it.
    restoreColumnFromSavedRun(m);

    // Step the column's shapes through the script (ROM 0x4A9D, twice): thirteen cells down from the
    // column top 0xA451 with direction bits C = 0x01, the cursor moved on thirteen script bytes, then
    // thirteen cells from the lower-run bottom 0xA7B1 with C = 0x03. The callee reads the script
    // through the shared cursor and leaves it where its walk ended.

    stepThirteenScriptedGlyphCells(m, CHAR_PLANE_COLUMN_BASE, 0x01);
    mem16[BAND_SCRIPT_CURSOR] = u16(mem16[BAND_SCRIPT_CURSOR] + SCRIPT_STRIDE);
    stepThirteenScriptedGlyphCells(m, CHAR_PLANE_LOWER_RUN_BOTTOM, 0x03);

    // Two more script bytes, read walking the cursor BACK one byte each (ROM `dec hl`). Bit 0 of the
    // first lowers the two column-centre cells by one tile code (ROM `dec (hl)` on 0xA5F1 and the cell a
    // row on, 0xA611); bit 0 of the second lowers the four flare-corner stubs the same way.
    let lower = mem8[mem16[BAND_SCRIPT_CURSOR]] & 1;
    mem16[BAND_SCRIPT_CURSOR] = u16(mem16[BAND_SCRIPT_CURSOR] - 1);
    if (lower) {
      mem8[CHAR_PLANE_COLUMN_MID_TOP] = u8(mem8[CHAR_PLANE_COLUMN_MID_TOP] - 1);
      mem8[CHAR_PLANE_COLUMN_MID_BOTTOM] = u8(mem8[CHAR_PLANE_COLUMN_MID_BOTTOM] - 1);
    }

    lower = mem8[mem16[BAND_SCRIPT_CURSOR]] & 1;
    mem16[BAND_SCRIPT_CURSOR] = u16(mem16[BAND_SCRIPT_CURSOR] - 1);
    if (lower) {
      mem8[CHAR_PLANE_STUB_UPPER_RIGHT] = u8(mem8[CHAR_PLANE_STUB_UPPER_RIGHT] - 1);
      mem8[CHAR_PLANE_STUB_UPPER_LEFT] = u8(mem8[CHAR_PLANE_STUB_UPPER_LEFT] - 1);
      mem8[CHAR_PLANE_STUB_LOWER_RIGHT] = u8(mem8[CHAR_PLANE_STUB_LOWER_RIGHT] - 1);
      mem8[CHAR_PLANE_STUB_LOWER_LEFT] = u8(mem8[CHAR_PLANE_STUB_LOWER_LEFT] - 1);
    }

    // Gather the column and stubs back into the saved thirty-two-byte run (ROM 0x158C, the exact
    // inverse of the restore above), so the next drawing pass starts from this pass's picture.
    gatherCharColumnIntoBackingRun(m);
  }

  // Both non-terminating passes end here (ROM 0x155B): count the pass down, which also flips bit 0 so
  // the next call runs the other kind of pass.
  mem8[BAND_TO4_PASS_COUNTDOWN] = u8(mem8[BAND_TO4_PASS_COUNTDOWN] - 1);
}
