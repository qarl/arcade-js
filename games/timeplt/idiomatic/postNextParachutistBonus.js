// SPDX-License-Identifier: GPL-3.0-only
/** postNextParachutistBonus — run one slot's countdown down by one and post the next command of a four-step run.
 * The step number is kept in the slot's own record and is read before it is stepped on, so the
 * first visit posts step zero. Each of the four steps supplies its own argument from a table;
 * once the number has gone past the last of them every further visit posts one fixed argument
 * instead, and the number keeps climbing rather than stopping or wrapping. All four steps and the
 * one past them share a single command byte, so what varies from visit to visit is the argument
 * alone. LIVE-OUT: memory.
 *
 * ROM 0x4831-0x484E (frozen lift translated/loc_4831.js). Grounding: [seen] (names.js ROUTINES
 * 0x4831). Role in the machine: the rescue award for catching a parachutist. Command 4 is the
 * ring's scoring command, and decoding the arguments gives 1,000 / 2,000 / 3,000 / 4,000 and
 * then 5,000 for every rescue after that — a ladder that rises and then caps (names.js,
 * mechanisms.md). The step byte is PARACHUTIST_RUNG (record +7) [seen], zeroed at every life
 * start, so the ladder restarts on death.
 *
 * `record` is the parachutist's slot record (IX in the ROM; PARACHUTIST_RECORD 0xA8F0 in
 * mechanisms.md).
 */

import { offsetAddress } from "./offsetAddress.js";
import { postCommand } from "./postCommand.js";
import { PARACHUTIST_BONUS_ARG_TABLE } from "./names.js";

// Record offsets and constants, read off the ROM: +0 is the slot's countdown (`dec (ix+0x00)`),
// +7 the rung (`ld a,(ix+0x07)`), `cp 0x04` bounds the four-entry table, `ld d,0x04` is the
// command, and `ld de,0x040f` gives the capped argument 0x0F.
const COUNTDOWN = 0;
const STEP = 7;
const STEPS = 4;
const COMMAND = 4;
const PAST_THE_LAST_STEP = 15;

export function postNextParachutistBonus(m, record = m.regs.ix) {
  const { mem8 } = m;

  /* Tick the slot's own countdown and take the rung. The rung is read BEFORE `inc (ix+0x07)`, so
   * the first rescue pays rung 0 and the stored count is always one ahead of what was paid.
   * Nothing bounds the increment; past the table it simply keeps climbing. */
  mem8[record + COUNTDOWN] = mem8[record + COUNTDOWN] - 1;
  const step = mem8[record + STEP];
  mem8[record + STEP] = step + 1;

  /* Pick the argument. Rungs 0-3 index PARACHUTIST_BONUS_ARG_TABLE (0x484F, laid inline right
   * after this routine) through offsetAddress — the `rst 0x18` HL += A step — and `ld e,(hl)`.
   * From rung 4 on, `jp nc,0x4849` skips the table and posts the fixed top argument instead. */
  let argument = PAST_THE_LAST_STEP;
  if (step < STEPS) {
    argument = mem8[offsetAddress(m, PARACHUTIST_BONUS_ARG_TABLE, step)];
  }
  /* Both arms tail-jump to 0x0038, postCommand: the (command, argument) pair goes into the
   * command ring and the score is added later when the ring is drained. */
  postCommand(m, COMMAND, argument);
}
