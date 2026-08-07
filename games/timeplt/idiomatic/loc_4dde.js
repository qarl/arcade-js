// SPDX-License-Identifier: GPL-3.0-only
/** loc_4dde — award the next milestone the moment a tally reaches one of its marks, once only.
 *
 * Nothing happens at all unless play is active. Which list of marks applies is fixed by one bit of
 * a settings cell, and which of two tallies is examined by a one-bit selector; only the tally's
 * top byte is looked at, so the marks are coarse. The list is searched for that byte exactly, not
 * compared against — a tally that steps over a mark between calls never matches it. A latch bit
 * makes the award one-shot: matching while it is already set does nothing, and the FIRST call that
 * does not match clears it again, so the same mark can be awarded again next time round the tally.
 * Awarding steps a running count on and asks for both the award and its sound, the count BEFORE
 * the step going out with the request. LIVE-OUT: memory. */

import { u16 } from "../../../core/int.js";
import { PLAY_ACTIVE, ACTIVE_PLAYER, LIVES_REMAINING } from "./names.js";
import { postCommand } from "./postCommand.js";
import { loc_5805 } from "./loc_5805.js";

const SETTING = 0xa9c3;
const MARKS_WHEN_CLEAR = 0x4e1b;
const MARKS_WHEN_SET = 0x4e30;
const FIRST_TALLY_TOP = 0xad35;
const SECOND_TALLY_TOP = 0xad38;
const LATCH = 0xad03;
const LATCH_BIT = 0x01;
const AWARD_COMMAND = 5;
const A_ZERO_LENGTH_MEANS = 65536;

export function loc_4dde(m) {
  const { mem8 } = m;
  if (mem8[PLAY_ACTIVE] === 0) return;

  const marks = (mem8[SETTING] & 1) === 0 ? MARKS_WHEN_CLEAR : MARKS_WHEN_SET;
  const length = mem8[marks];
  const span = length === 0 ? A_ZERO_LENGTH_MEANS : length;
  const reached = mem8[mem8[ACTIVE_PLAYER] === 0 ? FIRST_TALLY_TOP : SECOND_TALLY_TOP];

  let matched = false;
  for (let i = 1; i <= span && !matched; i++) matched = mem8[u16(marks + i)] === reached;

  if (!matched) {
    mem8[LATCH] &= ~LATCH_BIT;
    return;
  }
  if ((mem8[LATCH] & LATCH_BIT) !== 0) return;
  mem8[LATCH] |= LATCH_BIT;

  const awardsSoFar = mem8[LIVES_REMAINING];
  mem8[LIVES_REMAINING] = awardsSoFar + 1;
  postCommand(m, AWARD_COMMAND, awardsSoFar);
  loc_5805(m);
}
