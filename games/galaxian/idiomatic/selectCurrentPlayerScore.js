// SPDX-License-Identifier: GPL-3.0-only
// Selects the active player's 3-byte BCD score field: returns DE = PLAYER1_SCORE_BCD when CURRENT_PLAYER
// is 0, else PLAYER2_SCORE_BCD. Touches no memory.
import { CURRENT_PLAYER, PLAYER1_SCORE_BCD, PLAYER2_SCORE_BCD } from "./names.js";

export function selectCurrentPlayerScore(m) {
  const { mem8 } = m;

  // Player 1 is 0, player 2 is any nonzero value; return DE = the matching score field's base.
  const scorePtr = mem8[CURRENT_PLAYER] === 0 ? PLAYER1_SCORE_BCD : PLAYER2_SCORE_BCD;
  return (m.regs.de = scorePtr);
}
