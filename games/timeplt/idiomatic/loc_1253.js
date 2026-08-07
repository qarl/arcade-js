// SPDX-License-Identifier: GPL-3.0-only
/** loc_1253 — one step of the round sequence, which does one of two unrelated things depending on
 * whether a game is running. With play active it queues two fixed command pairs — the first of the
 * two carries an argument one higher while the second player is the one up — arms a countdown, and
 * steps the inner sequence index on. With play NOT active it tears the game down instead: the
 * active flag, the inner index and the player-up flag all go to zero and the outer phase is
 * reloaded from a byte of the program image. The inner index is then written a SECOND time, from a
 * fold over two more bytes of that image. LIVE-OUT: memory, plus the last command pair queued. */

import { u8 } from "../../../core/int.js";
import { PLAY_ACTIVE, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, ACTIVE_PLAYER, SEQUENCE_DELAY } from "./names.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { offsetAddress } from "./offsetAddress.js";
import { postCommand } from "./postCommand.js";

const TIMER_RELOAD = 180;

const FIRST_COMMAND = 2;
const FIRST_ARGUMENT = 9;
const SECOND_COMMAND = 10;
const SECOND_ARGUMENT = 11;

const RESTART_PHASE_CELL = 0x16d3;
const FOLD_ADDEND_CELL = 0x4901;
const FOLD_BASE_CELL = 0x4902;
const FOLD_BIAS = 155;

export function loc_1253(m) {
  const { regs, mem8 } = m;

  if (mem8[PLAY_ACTIVE] === 0) {
    mem8[PLAY_ACTIVE] = 0;
    mem8[SEQUENCE_SUBSTEP] = 0;
    mem8[ACTIVE_PLAYER] = 0;
    mem8[SEQUENCE_PHASE] = mem8[RESTART_PHASE_CELL];

    regs.a = mem8[FOLD_ADDEND_CELL];
    regs.hl = m.mem16[FOLD_BASE_CELL];
    const folded = offsetAddress(m);
    mem8[SEQUENCE_SUBSTEP] = u8((u8(folded) ^ (folded >> 8)) - FOLD_BIAS);
    return;
  }

  regs.d = FIRST_COMMAND;
  regs.e = FIRST_ARGUMENT + (mem8[ACTIVE_PLAYER] === 0 ? 0 : 1);
  postCommand(m);

  regs.d = SECOND_COMMAND;
  regs.e = SECOND_ARGUMENT;
  postCommand(m);

  mem8[SEQUENCE_DELAY] = TIMER_RELOAD;
  advanceSequenceSubStep(m);
}
