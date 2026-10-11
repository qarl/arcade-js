// SPDX-License-Identifier: GPL-3.0-only
/** floodColourPlaneWithSavedPlayerColour — flood the playfield's colour plane with one byte, then hand the sequence its next
 * step. The byte comes from one of two parallel cells, picked by a selector that says which of
 * two players is up. The area covered is a rectangle inset from the plane's edges, painted a row
 * at a time; when the picture is turned round the painting runs from the far corner backwards
 * instead, which changes the ORDER cells are touched in and not WHICH, so the two directions
 * leave the plane identical. A separate countdown is stepped down by one on the way out.
 * LIVE-OUT: memory only.
 *
 * ROM 0x13CC-0x1429 (lift: translated/loc_13cc.js). Grounding: [seen].
 *
 * Role in the machine: after a round is won the game plays a between-eras band animation
 * (sub-step 14 of the round engine, stepRoundWonBandAnimation), stepped by
 * ROUND_WON_ANIMATION_STEP (0xA9F0). This is its step-4 arm: it sets the step to 5, whose arm winds the
 * animation up, and washes the playfield's colour plane with the active player's saved pen colour.
 * The colour is the SAVED copy from the per-player save block (PLAYER_ONE_PEN_COLOUR 0xAD1C or
 * PLAYER_TWO_PEN_COLOUR 0xAD2C, chosen by ACTIVE_PLAYER 0xAD32), not the live PEN_COLOUR.
 */

import { ACTIVE_PLAYER, COLOUR_FLOOD_COUNTDOWN, COLOUR_FLOOD_FIRST_CELL, ROUND_WON_ANIMATION_STEP, PLAYER_ONE_PEN_COLOUR, PLAYER_TWO_PEN_COLOUR, SCREEN_UNFLIPPED } from "./names.js";

// The step this arm hands the band animation to (`ld a,0x05 / ld (0xa9f0),a`).
const NEXT_STEP = 5;

// The rectangle: from COLOUR_FLOOD_FIRST_CELL (0xA044, row 2 column 4 of the 32-wide colour
// plane), twenty-eight rows — every row the driver leaves visible — of twenty-seven cells, all but
// five of the plane's thirty-two columns. The ROM seeds one cell per row and lets a block copy
// (`ldir`, BC = 0x1A) smear it across the other twenty-six.
const FIRST_CELL = COLOUR_FLOOD_FIRST_CELL;
const ROW_STRIDE = 32;
const ROWS = 28;
const CELLS_PER_ROW = 27;
// The far corner the backwards pass starts from: the last cell the forwards pass paints, so the two
// directions cover the same rectangle.
const LAST_CELL = FIRST_CELL + ROW_STRIDE * (ROWS - 1) + (CELLS_PER_ROW - 1);

export function floodColourPlaneWithSavedPlayerColour(m) {
  const { mem8 } = m;
  // Hand the animation its next step first; the ROM stores it before doing any painting.
  mem8[ROUND_WON_ANIMATION_STEP] = NEXT_STEP;

  // Pick the fill: player one's saved pen colour when ACTIVE_PLAYER is 0, player two's otherwise.
  const source = mem8[ACTIVE_PLAYER] === 0 ? PLAYER_ONE_PEN_COLOUR : PLAYER_TWO_PEN_COLOUR;
  const colour = mem8[source];
  // SCREEN_UNFLIPPED (0xA987) reads 0 when the picture is turned round (a cocktail cabinet on
  // player two's turn). The ROM then paints from the far corner (0xA3BE) with `lddr` instead of
  // from 0xA044 with `ldir`.
  const backwards = mem8[SCREEN_UNFLIPPED] === 0;

  // Paint row by row. Forwards each row starts ROW_STRIDE further on and runs up; backwards each
  // starts ROW_STRIDE further back from the far corner and runs down. Either way the same
  // 28 x 27 cells end up holding the colour.
  for (let row = 0; row < ROWS; row++) {
    const start = backwards ? LAST_CELL - ROW_STRIDE * row : FIRST_CELL + ROW_STRIDE * row;
    for (let cell = 0; cell < CELLS_PER_ROW; cell++) {
      mem8[backwards ? start - cell : start + cell] = colour;
    }
  }

  // On the way out, step COLOUR_FLOOD_COUNTDOWN (0xA9F6) down by one (`ld a,(0xa9f6) / dec a /
  // ld (0xa9f6),a`); nothing but this stepper reads it.
  mem8[COLOUR_FLOOD_COUNTDOWN] = mem8[COLOUR_FLOOD_COUNTDOWN] - 1;
}
