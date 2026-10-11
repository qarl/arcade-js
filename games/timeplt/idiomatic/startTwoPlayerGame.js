// SPDX-License-Identifier: GPL-3.0-only
/**
 * startTwoPlayerGame — ROM 0x189E [seen]
 *
 * WHAT IT IS. The two-player start: it stocks the machine for a game with BOTH players' contexts
 * filled in and charges two credits for it. Its callers are stepTwoCreditCopyrightScreenAwaitingStart
 * and stepHighScoreInitialsEntry.
 *
 * ROLE IN THE MACHINE. In ROM order: park the copyright caption's sprites (hideCaptionSprites
 * 0x0B2B [seen]); raise PLAY_ACTIVE (0xAD30 [seen]) and TWO_PLAYER_GAME (0xAD31 [seen]) to all ones
 * -- the second is what later draws the 2-UP readout; load PLAYER_ONE_LIVES (0xAD10) and
 * PLAYER_TWO_LIVES (0xAD20) from STARTING_LIVES (0xA9C1, lives per game); run the two-player-start
 * arm (checkTamperGlyphCopyElseRunWreckFlash, 0x460E [seen]); take two off the packed-decimal CREDIT_COUNT
 * (0xA986) and repaint the credit panel; and send the sequence machine to its last outer phase, the
 * round engine (0x172A, a tail jump). It is startOnePlayerGame's charge with 2 in place of 1
 * (names.js), though unlike it this entry does not copy the three tilemap cells.
 * LIVE-OUT: memory only.
 */

import { u8 } from "../../../core/int.js";
import { hideCaptionSprites } from "./hideCaptionSprites.js";
import { checkTamperGlyphCopyElseRunWreckFlash } from "./checkTamperGlyphCopyElseRunWreckFlash.js";
import { paintCreditCountPanel } from "./paintCreditCountPanel.js";
import { seatSequencePhase3AndResetSubStep } from "./seatSequencePhase3AndResetSubStep.js";
import { CREDIT_COUNT, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, PLAY_ACTIVE, STARTING_LIVES, TWO_PLAYER_GAME } from "./names.js";

// PLAY_ACTIVE and TWO_PLAYER_GAME are both raised to 0xFF (`ld a,0xff`); two credits are charged.
const ALL_BITS = 255;
const TWO_CREDITS = 2;

// Constants of the decimal-adjust rule below: the low-digit mask, the largest valid packed-decimal
// byte, and the two corrections (6 for the units digit, 0x60 for the tens) a borrow calls for.
const LOW_DIGIT = 0x0f;
const HIGHEST = 0x99;
const DIGIT_BORROW = 6;
const TENS_BORROW = 0x60;

/** Take two off a packed-decimal byte, with the decimal correction the hardware applies after that
 * subtract, so a byte that was never valid packed decimal still lands where the hardware puts it. */
function stepPackedDecimalDownByTwo(value) {
  // The raw binary subtract (`sub 0x02`), then the correction the Z80's `daa` applies after a
  // subtract: 6 when the units digit borrowed (it was below 2) or reads above 9, 0x60 when the whole
  // byte borrowed (it was below 2) or reads above 0x99.
  const difference = u8(value - TWO_CREDITS);
  let correction = 0;
  if ((value & LOW_DIGIT) < TWO_CREDITS || (difference & LOW_DIGIT) > 9) correction += DIGIT_BORROW;
  if (value < TWO_CREDITS || difference > HIGHEST) correction += TENS_BORROW;
  return u8(difference - correction);
}

export function startTwoPlayerGame(m) {
  const { mem8 } = m;
  // Step 1 (`call 0x0b2b`): park the four copyright-caption sprites above the visible picture.
  hideCaptionSprites(m);

  // Step 2 (ROM 0x18A1-0x18B2): the player contexts. Play active, a two-player game, and both players'
  // lives from the settings cell.
  mem8[PLAY_ACTIVE] = ALL_BITS;
  mem8[TWO_PLAYER_GAME] = ALL_BITS;
  mem8[PLAYER_ONE_LIVES] = mem8[STARTING_LIVES];
  mem8[PLAYER_TWO_LIVES] = mem8[STARTING_LIVES];

  // Step 3 (`call 0x460e`): the two-player-start arm. Its acting arm (taken only when the witness
  // pair disagrees, which no MAME capture has shown) steps pointers the ROM leaves over in IX and IY
  // from earlier routines; this routine computes none, so it hands over none (null).
  checkTamperGlyphCopyElseRunWreckFlash(m, null, null);

  // Step 4 (ROM 0x18B5-0x18BD): charge two credits -- `ld hl,0xa986` / `ld a,(hl)` / `sub 0x02` /
  // `daa` / `ld (hl),a`.
  mem8[CREDIT_COUNT] = stepPackedDecimalDownByTwo(mem8[CREDIT_COUNT]);

  // Step 5: repaint the credit count on screen (`call 0x4afb`), then move the sequence machine to the
  // round engine, phase 3 with its inner step reset (`jp 0x172a`).
  paintCreditCountPanel(m);
  seatSequencePhase3AndResetSubStep(m);
}
