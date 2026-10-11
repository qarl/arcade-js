// SPDX-License-Identifier: GPL-3.0-only
/**
 * awardBonusLifeAtScoreMark — award an extra life when the active player's score reaches a bonus mark,
 * once per mark.
 *
 * ROM 0x4DDE-0x4E1A. Grounding: [seen] (names.js ROUTINES 0x4DDE).
 *
 * ROLE IN THE MACHINE. Called once per pass of the round engine's service list
 * (serviceRoundThenResolvePlayerState), and does nothing unless PLAY_ACTIVE (0xAD30) [seen] is set, so the
 * attract demo never earns lives.
 *
 * HOW A MARK IS RECOGNISED. Scores are packed decimal, three bytes per player; only the TOP byte (0xAD35 for
 * player one, 0xAD38 for player two, chosen by ACTIVE_PLAYER [seen]) is compared, and it must EQUAL an entry
 * of the mark list — the ROM searches with `cpir`, which only finds exact matches. Which list applies is set
 * by bit 0 of BONUS_LIFE_SETTING (0xA9C3): the list at ROM 0x4E1B when clear, 0x4E30 when set. Each list
 * starts with a length byte followed by the marks.
 *
 * WHY A LATCH. The top byte stays at a mark value for many passes after the score reaches it, so bit 0 of
 * BONUS_LIFE_LATCH (0xAD03) [seen] makes the award one-shot: a match while the bit is set does nothing, and
 * the first pass whose top byte matches no mark clears it again.
 *
 * THE AWARD increments LIVES_REMAINING (0xAD00) [seen], posts ring command 5 (redraw the reserve-ship emblem strip) carrying the count from BEFORE
 * the increment, and tail-jumps into requestBonusLifeSound (ROM 0x5805).
 *
 * LIVE-OUT: memory.
 */

import { u16 } from "../../../core/int.js";
import { ACTIVE_PLAYER, BONUS_LIFE_LATCH, BONUS_LIFE_SETTING, BONUS_LIFE_MARK_TABLE_BIT0_CLEAR, BONUS_LIFE_MARK_TABLE_BIT0_SET, LIVES_REMAINING, PLAYER1_SCORE_HI, PLAYER2_SCORE_HI, PLAY_ACTIVE } from "./names.js";
import { postCommand } from "./postCommand.js";
import { requestBonusLifeSound } from "./requestBonusLifeSound.js";

const MARKS_WHEN_CLEAR = BONUS_LIFE_MARK_TABLE_BIT0_CLEAR;
const MARKS_WHEN_SET = BONUS_LIFE_MARK_TABLE_BIT0_SET;
/** Bit 0 of BONUS_LIFE_LATCH: set once a mark has paid (ROM `bit/set/res 0,(hl)` on 0xAD03). */
const LATCH_BIT = 0x01;
/** The ring command that redraws the reserve-ship emblem strip, posted with an award (ROM `ld d,0x05; rst 0x38`). */
const EMBLEM_STRIP_COMMAND = 5;
/** `cpir` with a count of zero runs 65536 times before BC runs out, so a zero length byte means 65536. */
const A_ZERO_LENGTH_MEANS = 65536;

export function awardBonusLifeAtScoreMark(m) {
  const { mem8 } = m;
  // Only during a credited game (ROM `ld a,(0xad30); and a; ret z`).
  if (mem8[PLAY_ACTIVE] === 0) return;

  // Pick the mark list from the settings bit, take its length byte, and fetch the active player's top
  // score byte — the value to search for.

  const marks = (mem8[BONUS_LIFE_SETTING] & 1) === 0 ? MARKS_WHEN_CLEAR : MARKS_WHEN_SET;
  const length = mem8[marks];
  const span = length === 0 ? A_ZERO_LENGTH_MEANS : length;
  const reached = mem8[mem8[ACTIVE_PLAYER] === 0 ? PLAYER1_SCORE_HI : PLAYER2_SCORE_HI];

  // The `cpir` search: walk the marks after the length byte, stopping at the first equal one.
  let matched = false;
  for (let i = 1; i <= span && !matched; i++) matched = mem8[u16(marks + i)] === reached;

  // No mark matched: re-arm the one-shot and stop.
  if (!matched) {
    mem8[BONUS_LIFE_LATCH] &= ~LATCH_BIT;
    return;
  }
  // A mark matched: pay only if it has not already paid, and latch it so the next passes do not.
  if ((mem8[BONUS_LIFE_LATCH] & LATCH_BIT) !== 0) return;
  mem8[BONUS_LIFE_LATCH] |= LATCH_BIT;

  // Award: one more life, post the pre-award count to the emblem strip (command 5), and ask for the award sound.
  const livesBeforeAward = mem8[LIVES_REMAINING];
  mem8[LIVES_REMAINING] = livesBeforeAward + 1;
  postCommand(m, EMBLEM_STRIP_COMMAND, livesBeforeAward);
  requestBonusLifeSound(m);
}
