// SPDX-License-Identifier: GPL-3.0-only
/** awardScoreToPlayer — the score-award command: add the award the argument picks to the current player's
 * packed-decimal score, lift that score into the high score when it now beats it, and repaint the
 * scores it touched. A zero argument takes a separate arm that only (re)paints the score labels and scores
 * and, in a one-player game, erases the absent second label and blanks its score. A flag can veto the whole command.
 * LIVE-OUT: memory.
 *
 * ROM 0x0C90-0x0D1A (frozen lift translated/loc_0c90.js). Grounding: [seen] in names.js.
 *
 * Role in the machine: this is handler 4 of the command ring. A kill is scored by posting command 4
 * with an award id (rst 0x38; advanceHitSoakingObjectThenAnimateDeath is one such poster), and the
 * foreground ring drain later runs this routine with that id as `award`. Each player's score is three packed-BCD bytes stored
 * LOW byte first (PLAYER1_SCORE_LO 0xAD33, PLAYER2_SCORE_LO 0xAD36), which is the order the
 * decimal add walks them; ACTIVE_PLAYER (0xAD32) chooses which one. The single displayed high score
 * ends at HIGH_SCORE_HI (0xA98D), its most significant byte. */

import { paintPlayerOneScoreReadout } from "./paintPlayerOneScoreReadout.js";
import { paintPlayerTwoScoreReadout } from "./paintPlayerTwoScoreReadout.js";
import { paintHighScoreReadout } from "./paintHighScoreReadout.js";
import { drawTextRunByIndex } from "./drawTextRunByIndex.js";
import { eraseTextRunByIndex } from "./eraseTextRunByIndex.js";
import { advanceCharCursor } from "./advanceCharCursor.js";
import { HIGH_SCORE_HI, PLAYER1_SCORE_LO, PLAYER2_SCORE_LO, TWO_PLAYER_GAME, PLAY_ACTIVE, ACTIVE_PLAYER } from "./names.js";
import { SCORE_AWARD_TABLE, SOLO_SCORE_LABEL_INDEX, ABSENT_SCORE_LABEL_INDEX, PLAYER2_SCORE_READOUT_BASE } from "./names.js";

// Each score and each award table entry is three packed-decimal bytes (six digits).
const SCORE_BYTES = 3;

// The two-player arm draws the two score labels by their literal caption indices (`ld a,0x06` / `ld a,0x07`).
const P1_LABEL = 0x06;
const P2_LABEL = 0x07;
// One-player arm: six character cells of the second score, blanked with glyph 0xF1.
const SECOND_SCORE_DIGITS = 6;
const BLANK = 0xf1;

// Packed decimal (BCD): one decimal digit per nibble. These two helpers do in JS what the ROM's
// `add a,(hl) / adc a,(hl)` + `daa` pairs do in hardware: a decimal add with carry between bytes.
const fromPackedDecimal = (byte) => (byte >> 4) * 10 + (byte & 0x0f);
const toPackedDecimal = (n) => ((n / 10) << 4) | (n % 10);

export function awardScoreToPlayer(m, award = m.regs.a) {
  const { mem8 } = m;
  /* The veto (0x0C93): outside live play (PLAY_ACTIVE 0xAD30 zero — attract and the demo) the
   * command does nothing at all, so nothing posted during attract or the demo reaches a score. Award id 0 is not
   * an award but a request to (re)draw the score labels (0x0CE9, repaintScores below). */
  if (mem8[PLAY_ACTIVE] === 0) return;
  if (award === 0) return repaintScores(m);

  /* Credit the active player (0x0C9F-0x0CC0), then check the high score (0x0CC1-0x0CD7). */

  const scoreBase = mem8[ACTIVE_PLAYER] === 0 ? PLAYER1_SCORE_LO : PLAYER2_SCORE_LO;
  addAwardToScore(m, scoreBase, award);
  promoteHighScoreIfBeaten(m, scoreBase);

  /* Repaint the score just changed (0x0CDA-0x0CE5): 2-UP (0x0D61) for player two, else 1-UP (0x0D57). */

  if (mem8[ACTIVE_PLAYER] !== 0) paintPlayerTwoScoreReadout(m);
  else paintPlayerOneScoreReadout(m);
  return;
}

/** Add the packed-decimal award the argument selects into the score, least significant byte first.
 * The award is entry `award` of SCORE_AWARD_TABLE (0x0D27), three bytes per entry (the ROM forms
 * the offset as `add hl,bc` three times). A carry out of the top byte is dropped, as in the ROM. */
function addAwardToScore(m, scoreBase, award) {
  const { mem8 } = m;
  const awardBase = SCORE_AWARD_TABLE + SCORE_BYTES * award;
  let carry = 0;
  for (let i = 0; i < SCORE_BYTES; i++) {
    const sum = fromPackedDecimal(mem8[scoreBase + i]) + fromPackedDecimal(mem8[awardBase + i]) + carry;
    carry = sum >= 100 ? 1 : 0;
    mem8[scoreBase + i] = toPackedDecimal(sum % 100);
  }
}

/** Copy the freshly credited score into the high score, and repaint it, once it leads. The score is
 * stored low byte first from scoreBase; the high score high byte first from HIGH_SCORE_HI, so both
 * are read most significant byte first as k counts up. */
function promoteHighScoreIfBeaten(m, scoreBase) {
  const { mem8 } = m;
  const scoreByte = (k) => mem8[scoreBase + (SCORE_BYTES - 1 - k)];
  const highByte = (k) => mem8[HIGH_SCORE_HI - k];
  /* Compare most significant byte first (0x0CC7-0x0CD2): stop at the first byte that differs; if all
   * three match, or the score's byte is lower, the high score stands. */
  let k = 0;
  while (k < SCORE_BYTES && scoreByte(k) === highByte(k)) k++;
  if (k === SCORE_BYTES || scoreByte(k) < highByte(k)) return;
  /* It leads: copy it over the high score (the ROM's `lddr` at 0x0CD5) and redraw it (0x0D6B). */
  for (let j = 0; j < SCORE_BYTES; j++) mem8[HIGH_SCORE_HI - j] = scoreByte(j);
  paintHighScoreReadout(m);
}

/** Award id 0 (0x0CE9-0x0D1A): draw the score labels and scores for the kind of game in progress.
 * Two players (TWO_PLAYER_GAME 0xAD31 set): label 6 + 1-UP score, label 7 + 2-UP score. One player:
 * the label whose index is the ROM byte at 0x0B31, the 1-UP score, then erase the absent second
 * player's label (index from the ROM byte at 0x15C6) and blank its score digits. */
function repaintScores(m) {
  const { mem8 } = m;
  if (mem8[TWO_PLAYER_GAME] !== 0) {
    drawTextRunByIndex(m, P1_LABEL);
    paintPlayerOneScoreReadout(m);
    drawTextRunByIndex(m, P2_LABEL);
    paintPlayerTwoScoreReadout(m);
    return;
  }
  drawTextRunByIndex(m, mem8[SOLO_SCORE_LABEL_INDEX]);
  paintPlayerOneScoreReadout(m);
  eraseTextRunByIndex(m, mem8[ABSENT_SCORE_LABEL_INDEX]);
  // blank the six cells of the vanished second player's score, stepping the cursor per cell.
  // advanceCharCursor takes the cursor and returns the next cell, so no register is threaded here.
  let cursor = PLAYER2_SCORE_READOUT_BASE;
  for (let i = 0; i < SECOND_SCORE_DIGITS; i++) {
    mem8[cursor] = BLANK;
    cursor = advanceCharCursor(m, cursor);
  }
}
