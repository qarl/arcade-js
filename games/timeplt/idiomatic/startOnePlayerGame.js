// SPDX-License-Identifier: GPL-3.0-only
/**
 * startOnePlayerGame — ROM 0x3215 [seen]
 *
 * WHAT IT IS. The charged one-player start: it stocks the machine for a game with only
 * the FIRST player's context filled in and charges one credit for it. Its callers are the
 * push-start screens (stepCopyrightScreenAwaitingStart, stepTwoCreditCopyrightScreenAwaitingStart)
 * and stepHighScoreInitialsEntry.
 *
 * ROLE IN THE MACHINE. In ROM order: park the copyright caption's sprites (hideCaptionSprites
 * 0x0B2B [seen]); clear TWO_PLAYER_GAME (0xAD31 [seen], the byte beside PLAY_ACTIVE) and
 * PLAYER_TWO_LIVES (0xAD20), which is what makes a hand-over to a second player impossible later;
 * raise PLAY_ACTIVE (0xAD30 [seen]) to all ones, the flag that separates real play from the attract
 * demo; load PLAYER_ONE_LIVES (0xAD10) from STARTING_LIVES (0xA9C1, the DSW-configured lives per
 * game); take one off the packed-decimal CREDIT_COUNT (0xA986) and repaint the credit panel; copy
 * three tilemap cells into their keeps; and send the sequence machine to its last outer phase, the
 * round engine (0x172A, a tail jump).
 *
 * Its player-context block matches startGameOnFreePlay's one-player arm
 * at 0x1719: the same seven instructions (four stores) in the same order, both ending at 0x172A. Around
 * that block this entry also parks the caption sprites first (0x0B2B) and copies the three tilemap
 * cells (0x4B30), which the free-play arm does not. This entry alone puts
 * the credit subtract and repaint between that block and the 0x172A tail. The store order itself carries no meaning.
 * LIVE-OUT: memory only.
 */

import { u8 } from "../../../core/int.js";
import { hideCaptionSprites } from "./hideCaptionSprites.js";
import { seatSequencePhase3AndResetSubStep } from "./seatSequencePhase3AndResetSubStep.js";
import { paintCreditCountPanel } from "./paintCreditCountPanel.js";
import { copyThreeTilemapCellsFromBothPlanes } from "./copyThreeTilemapCellsFromBothPlanes.js";
import { CREDIT_COUNT, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, PLAY_ACTIVE, STARTING_LIVES, TWO_PLAYER_GAME } from "./names.js";

// The value PLAY_ACTIVE is raised to (`xor a` then `dec a`: 0x00 -> 0xFF).
const ALL_BITS = 255;

// Constants of the decimal-adjust rule below: the low-digit mask, the largest valid packed-decimal
// byte, and the two corrections (6 for the units digit, 0x60 for the tens) a borrow calls for.
const LOW_DIGIT = 0x0f;
const HIGHEST = 0x99;
const DIGIT_BORROW = 6;
const TENS_BORROW = 0x60;

/** Take one off a packed-decimal byte, applying the decimal correction exactly as the hardware
 * does after that subtract, so a byte that was never valid packed decimal still lands where the
 * hardware would put it rather than where a tidier rule would. */
function stepPackedDecimalDown(value) {
  // The raw binary subtract (`sub 0x01`), then the correction the Z80's `daa` applies after a
  // subtract: 6 when the units digit borrowed (it was 0) or reads above 9, 0x60 when the whole byte
  // borrowed (it was 0) or reads above 0x99.
  const difference = u8(value - 1);
  let correction = 0;
  if ((value & LOW_DIGIT) === 0 || (difference & LOW_DIGIT) > 9) correction += DIGIT_BORROW;
  if (value === 0 || difference > HIGHEST) correction += TENS_BORROW;
  return u8(difference - correction);
}

export function startOnePlayerGame(m) {
  const { mem8 } = m;
  // Step 1 (`call 0x0b2b`): park the four copyright-caption sprites above the visible picture.
  hideCaptionSprites(m);

  // Step 2 (ROM 0x3219-0x3229): the player context. Not a two-player game, no lives for player two,
  // play active, and player one's lives from the settings cell.
  mem8[TWO_PLAYER_GAME] = 0;
  mem8[PLAYER_TWO_LIVES] = 0;
  mem8[PLAY_ACTIVE] = ALL_BITS;
  mem8[PLAYER_ONE_LIVES] = mem8[STARTING_LIVES];
  // Step 3 (ROM 0x3229-0x3230): charge one credit -- `ld hl,0xa986` / `ld a,(hl)` / `sub 1` / `daa`
  // / `ld (hl),a`.
  mem8[CREDIT_COUNT] = stepPackedDecimalDown(mem8[CREDIT_COUNT]);

  // Step 4: repaint the credit count on screen (`call 0x4afb`), copy the three tilemap cells into their
  // keeps (`call 0x4b30`), and move the sequence machine to the round engine, phase 3 with its inner
  // step reset (`jp 0x172a`).
  paintCreditCountPanel(m);
  copyThreeTilemapCellsFromBothPlanes(m);
  seatSequencePhase3AndResetSubStep(m);
}
