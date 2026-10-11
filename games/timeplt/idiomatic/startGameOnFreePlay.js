// SPDX-License-Identifier: GPL-3.0-only
/** startGameOnFreePlay — start a game for whichever start button the input mirror shows held --
 * two players if the two-player bit is set, one if only the one-player bit is -- stocking each
 * started player's block with the lives setting, and charging no credit.
 *
 * ROLE. On a free-play cabinet no coin is needed, so the start buttons alone begin a game. All
 * three callers test the FREE_PLAY cell before reaching here (two by tail jump, one by falling through), which is why this path takes no
 * credit (the coin path, startTwoPlayerGame, subtracts two in packed BCD). With neither button
 * held it does nothing at all. The two-player button wins outright: it is tested first and its arm
 * never looks at the one-player bit. Both arms raise PLAY_ACTIVE and stock player one's lives from
 * STARTING_LIVES (the DIP lives setting); the two-player arm also raises TWO_PLAYER_GAME and stocks
 * player two, where the one-player arm clears both of those -- player two's zero lives is what
 * later makes a hand-over impossible in a one-player game. Either arm then hands over to
 * seatSequencePhase3AndResetSubStep (ROM 0x172A), which seats the sequence machine at its last
 * outer phase, phase 3, with the sub-step at zero -- the phase in which the round engine runs.
 *
 * ROM 0x1690-0x16AE and 0x1719-0x1729 (frozen lift translated/loc_1690.js; the one-player arm lives
 * at 0x1719). Grounding: [seen] (names.js ROUTINES 0x1690). LIVE-OUT: memory.
 */

import { IN0_MIRROR, PLAYER_ONE_LIVES, PLAYER_TWO_LIVES, PLAY_ACTIVE, STARTING_LIVES, TWO_PLAYER_GAME } from "./names.js";
import { seatSequencePhase3AndResetSubStep } from "./seatSequencePhase3AndResetSubStep.js";


// IN0_MIRROR bits (the vblank service stores the complemented, active-high port): bit 4 is the
// two-player start button, bit 3 the one-player start button (ROM `bit 4,a` / `bit 3,a`).
const START_TWO_PLAYER = 0x10;
const START_ONE_PLAYER = 0x08;
// Flags in this machine are all-ones when raised.
const SET = 0xff;

export function startGameOnFreePlay(m) {
  const { mem8 } = m;
  // Neither start button held: return without touching anything (ROM `ret` at 0x169B).
  const panel = mem8[IN0_MIRROR];
  if ((panel & (START_TWO_PLAYER | START_ONE_PLAYER)) === 0) return;

  // Two-player takes precedence; the one-player bit only matters when bit 4 is clear.
  const twoPlayer = (panel & START_TWO_PLAYER) !== 0;
  const allowance = mem8[STARTING_LIVES];
  // Both arms: a credit's worth of play is now active, and player one gets the full allowance.
  // Two-player arm (0x169C): TWO_PLAYER_GAME = 0xFF and player two also gets the allowance.
  // One-player arm (0x1719): TWO_PLAYER_GAME = 0 and player two's lives are zeroed.
  mem8[PLAY_ACTIVE] = SET;
  mem8[TWO_PLAYER_GAME] = twoPlayer ? SET : 0;
  mem8[PLAYER_ONE_LIVES] = allowance;
  mem8[PLAYER_TWO_LIVES] = twoPlayer ? allowance : 0;
  // Tail-jump into the sequence machine (`jr 0x172a` / fall-through at 0x1727).
  seatSequencePhase3AndResetSubStep(m);
}
