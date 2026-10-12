// SPDX-License-Identifier: GPL-3.0-only
/** advanceScriptedCharPlaneBandTo2 — advance one frame of the scripted character-plane animation, chosen by bit 0 of a
 * per-pass counter. Even passes blank the band column's two thirteen-cell runs and six loose cells to the blank tile. Odd
 * passes read the byte under the script cursor: 0xff ends the script — the counter is zeroed, the
 * stage set to 2 and the cursor stepped back one, returning early with no decrement. Otherwise the
 * saved run is laid back down a column, two cursor bits each step a set of glyph cells on by one tile code, the
 * column's shapes are stepped twice through the script, and the column is gathered back into its
 * run. Every non-early pass ends by decrementing the counter. LIVE-OUT: memory.
 *
 * ROM 0x142A-0x14C4 (frozen lift translated/loc_142a.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. When a round is won, the sequence machine plays a "band" animation on the
 * character plane before the next era starts (mechanisms.md, "Round won: the band animation").
 * armRoundWonBandAnimationThenStepSequence stocks the control block at 0xA9F0-0xA9F8 once --
 * BAND_TO2_PASS_COUNTDOWN (0xA9F2) to 0xFF, BAND_SCRIPT_CURSOR (0xA9F7) to BAND_SCRIPT_START
 * (0x56F1) -- and then stepRoundWonBandAnimation (0x1323) calls this entry on each frame it runs
 * (those with FRAME_TICK bit 1 clear) while ROUND_WON_ANIMATION_STEP (0xA9F0) is 1. This is the FIRST half of the band script; the second half is
 * advanceScriptedCharPlaneBandTo4, which this entry hands over to by writing step 2.
 *
 * THE GEOMETRY. The band is one video-RAM column (column 0x11 of the 32x32 character plane) split
 * into two thirteen-cell runs -- the upper run ending at CHAR_PLANE_RIGHT_RUN_INNER 0xA5D1, the
 * lower run from CHAR_PLANE_LEFT_RUN_INNER 0xA631 down to CHAR_PLANE_LEFT_RUN_OUTER 0xA7B1 -- with
 * two centre cells (0xA5F1 / 0xA611) between them and four "stub" corner cells in the neighbouring
 * columns (0xA5F0, 0xA5F2, 0xA610, 0xA612). Under the board's ROT90 a fixed native column is a
 * horizontal line on the glass, so the runs read as a full-width streak with flares at its centre.
 * The upper/lower runs, and a step a row up, down or above, count native rows (on the glass the upper
 * run lies right of centre, the lower run left); the CHAR_PLANE_STUB_* names give each corner's place on the glass.
 * A 32-byte copy of the column lives in the never-displayed first row of the plane (0xA400-0xA41F);
 * restoreColumnFromSavedRun lays it down and gatherCharColumnIntoBackingRun takes it back up, so the
 * edits made between them persist even though the blanking passes wipe the visible cells.
 */

import { fillCellRun } from "./fillCellRun.js";
import { restoreColumnFromSavedRun } from "./restoreColumnFromSavedRun.js";
import { stepThirteenScriptedGlyphCells } from "./stepThirteenScriptedGlyphCells.js";
import { gatherCharColumnIntoBackingRun } from "./gatherCharColumnIntoBackingRun.js";
import {
  BAND_SCRIPT_CURSOR,
  BAND_TO2_PASS_COUNTDOWN,
  ROUND_WON_ANIMATION_STEP,
  CHAR_PLANE_RIGHT_RUN_INNER,
  CHAR_PLANE_STUB_UPPER_RIGHT,
  CHAR_PLANE_COLUMN_MID_RIGHT,
  CHAR_PLANE_STUB_LOWER_RIGHT,
  CHAR_PLANE_STUB_UPPER_LEFT,
  CHAR_PLANE_COLUMN_MID_LEFT,
  CHAR_PLANE_STUB_LOWER_LEFT,
  CHAR_PLANE_LEFT_RUN_INNER,
  CHAR_PLANE_LEFT_RUN_OUTER,
} from "./names.js";

// The blank glyph code (the ROM's `ld a,0xf1` at 0x149D), one character row of the plane (32 cells,
// the ROM's DE = 0x0020 / 0xFFE0 step), and the script's terminator byte (`cp 0xff` at 0x1435).
const BLANK_TILE = 0xf1;
const ROW = 0x20;
const END_OF_SCRIPT = 0xff;

export function advanceScriptedCharPlaneBandTo2(m) {
  const { mem8, mem16 } = m;

  // Bit 0 of the countdown picks the pass (ROM `bit 0,a` at 0x142D). The countdown starts at 0xFF
  // and drops by one each pass, so the two kinds alternate call by call: a drawing pass, then a
  // blanking pass, then a drawing pass again.
  if ((mem8[BAND_TO2_PASS_COUNTDOWN] & 1) === 0) {
    // BLANKING PASS (ROM 0x149D-0x14BD). Both thirteen-cell runs are filled with the blank glyph by
    // fillCellRun (0x1319), each starting at its run's bottom cell. Then three cells of native
    // row 16 -- the left upper stub, the lower centre cell and the left lower stub -- are blanked
    // together with the cell one row above each (the ROM's `add hl,de` with DE = -0x20), which
    // covers the centre pair and all four stubs. Only the visible cells are touched; the saved copy
    // in the hidden first row is left as it is, so the next drawing pass can put the picture back.
    fillCellRun(m, BLANK_TILE, CHAR_PLANE_LEFT_RUN_OUTER);
    fillCellRun(m, BLANK_TILE, CHAR_PLANE_RIGHT_RUN_INNER);
    for (const cell of [CHAR_PLANE_STUB_UPPER_LEFT, CHAR_PLANE_COLUMN_MID_LEFT, CHAR_PLANE_STUB_LOWER_LEFT]) {
      mem8[cell] = BLANK_TILE;
      mem8[cell - ROW] = BLANK_TILE;
    }
  } else {
    // DRAWING PASS. First the terminator test (ROM 0x1431-0x144A): a script byte of 0xFF under the
    // cursor ends this half of the animation. The countdown is zeroed, ROUND_WON_ANIMATION_STEP is set to
    // 2 so the band-to-4 half runs from the next frame, and the cursor is stepped BACK one so the
    // second half starts reading at the byte before the terminator. The ROM returns straight out
    // of this arm, so on this one pass the countdown is not decremented.
    if (mem8[mem16[BAND_SCRIPT_CURSOR]] === END_OF_SCRIPT) {
      mem8[BAND_TO2_PASS_COUNTDOWN] = 0;
      mem8[ROUND_WON_ANIMATION_STEP] = 2;
      mem16[BAND_SCRIPT_CURSOR] = mem16[BAND_SCRIPT_CURSOR] - 1;
      return;
    }
    // Put the saved picture back onto the visible column before editing it (ROM `call 0x1563`).
    restoreColumnFromSavedRun(m);

    // Script byte 1, bit 0 (ROM 0x144E-0x1469): when set, each of the four stub corner cells is
    // stepped on to the next glyph code (`inc (hl)` on 0xA5F0, 0xA610, 0xA5F2, 0xA612). The cursor
    // moves past the byte whether or not the bit is set. The step is on the glyph CODE, so each
    // corner cell shows the next tile code of the character set.
    let cursor = mem16[BAND_SCRIPT_CURSOR];
    const firstBit = mem8[cursor] & 1;
    mem16[BAND_SCRIPT_CURSOR] = cursor + 1;
    if (firstBit !== 0) {
      mem8[CHAR_PLANE_STUB_UPPER_RIGHT] = mem8[CHAR_PLANE_STUB_UPPER_RIGHT] + 1;
      mem8[CHAR_PLANE_STUB_UPPER_LEFT] = mem8[CHAR_PLANE_STUB_UPPER_LEFT] + 1;
      mem8[CHAR_PLANE_STUB_LOWER_RIGHT] = mem8[CHAR_PLANE_STUB_LOWER_RIGHT] + 1;
      mem8[CHAR_PLANE_STUB_LOWER_LEFT] = mem8[CHAR_PLANE_STUB_LOWER_LEFT] + 1;
    }

    // Script byte 2, bit 0 (ROM 0x1469-0x147E): when set, the two centre cells of the column
    // (0xA5F1 above 0xA611) are stepped on one glyph code. Again the cursor always moves on.
    cursor = mem16[BAND_SCRIPT_CURSOR];
    const secondBit = mem8[cursor] & 1;
    mem16[BAND_SCRIPT_CURSOR] = cursor + 1;
    if (secondBit !== 0) {
      mem8[CHAR_PLANE_COLUMN_MID_RIGHT] = mem8[CHAR_PLANE_COLUMN_MID_RIGHT] + 1;
      mem8[CHAR_PLANE_COLUMN_MID_LEFT] = mem8[CHAR_PLANE_COLUMN_MID_LEFT] + 1;
    }

    // The two thirteen-cell runs are stepped through the SAME thirteen script bytes (ROM 0x147E on,
    // two calls to stepThirteenScriptedGlyphCells at 0x4A9D). The upper run goes first with mode 2
    // -- bit 1 set, so it walks a row UP from its bottom cell, i.e. outward from the centre. The
    // cursor is then wound back thirteen so the lower run reads the identical bytes, walking DOWN
    // from its top cell with mode 0 -- also outward from the centre. The two runs therefore take
    // the same script edits as mirror images of each other about the centre cells.
    stepThirteenScriptedGlyphCells(m, CHAR_PLANE_RIGHT_RUN_INNER, 2);
    mem16[BAND_SCRIPT_CURSOR] = mem16[BAND_SCRIPT_CURSOR] - 13;
    stepThirteenScriptedGlyphCells(m, CHAR_PLANE_LEFT_RUN_INNER, 0);
    // Save the edited column back into the hidden backing row (ROM `call 0x158c`), so the next
    // blanking pass cannot lose this frame's progress.
    gatherCharColumnIntoBackingRun(m);
  }

  // Both kinds of pass (but not the terminator arm, which returned above) end by stepping the
  // countdown down one (ROM `ld a,(0xa9f2) / dec a / ld (0xa9f2),a` at 0x14BD), which flips bit 0
  // and so selects the other kind of pass for the next call.
  mem8[BAND_TO2_PASS_COUNTDOWN] = mem8[BAND_TO2_PASS_COUNTDOWN] - 1;
}
