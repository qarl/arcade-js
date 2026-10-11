// SPDX-License-Identifier: GPL-3.0-only
/**
 * flashCopyrightLine — make the copyright line change colour every frame.
 *
 * WHAT IT IS: ROM 0x0B39-0x0B45, tag [seen] (names.js ROUTINES 0x0b39). It queues one fixed command on
 * the command ring whose ARGUMENT alternates: the lowest bit of the frame counter chooses between two
 * arguments, and nothing else about the pair varies. The counter is only read.
 *
 * WHY IT IS A COLOUR FLASH: command 1 draws a caption record from the caption table at 0x0C50 using that
 * record's own colour byte. The two arguments, 0x00 and 0x1F, pick two records with the same destination
 * (0xA6BC) and the same thirteen glyphs (a copyright mark, KONAMI, 1982), differing only in colour, 0x10
 * against 0x05 -- so only the colour can alternate (names.js "why" for 0x0b39, confirmed by a MAME write
 * tap on the line's first colour cell).
 *
 * ROLE IN THE MACHINE: called by the sequence arms that keep the copyright screen up -- among them
 * postPushStartScreenCaptions, stepCopyrightScreenAwaitingStart and stepTwoCreditCopyrightScreenAwaitingStart
 * (steps 2-4 of phase 2, mechanisms.md) -- which restamp the copyright strip and then flash its line.
 * The frame counter advances once per vblank, so the colour flips on every frame.
 *
 * Queueing is not a guarantee -- the ring append drops the pair when the ring cell the write cursor names
 * has not yet been consumed, and this entry never learns that, so a frame can silently miss its turn.
 *
 * LIVE-OUT: memory (the command ring), plus, on the odd-frame path, the pair left in the registers.
 */

import { enqueueFixedCommandOnRing } from "./enqueueFixedCommandOnRing.js";
import { postCommand } from "./postCommand.js";
import { FRAME_TICK } from "./names.js";

/* Command 1: draw a caption record in the record's own colour (the ROM loads it as D of `ld de,0x0100`). */
const COMMAND = 1;
/* The argument queued on odd frames (E of `ld de,0x0100`): the caption record whose colour is 0x10. */
const ARGUMENT_ON_THE_ODD_TURN = 0;

export function flashCopyrightLine(m) {
  /*
   * Even frame (FRAME_TICK 0xA980 bit 0 clear; the ROM's `bit 0,a / jr z,0x0b46`): hand over to
   * enqueueFixedCommandOnRing (0x0B46), which queues the same command 1 with the OTHER argument, 0x1F
   * (its `ld de,0x011f`) -- the record whose colour is 0x05. The ROM reaches it by a tail jump, so
   * nothing is handed back from this path.
   */
  if ((m.mem8[FRAME_TICK] & 1) === 0) {
    enqueueFixedCommandOnRing(m);
    return;
  }
  /*
   * Odd frame: queue command 1 with argument 0x00 through postCommand (the ROM's `ld de,0x0100 /
   * jp 0x0038`, the shared ring-append entry). The ROM leaves the pair in D and E on the way out, and
   * that is kept visible here.
   */
  postCommand(m, COMMAND, ARGUMENT_ON_THE_ODD_TURN);
  return [(m.regs.d = COMMAND), (m.regs.e = ARGUMENT_ON_THE_ODD_TURN)];
}
