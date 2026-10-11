// SPDX-License-Identifier: GPL-3.0-only
/**
 * drawRoundNumberCaption — paint the round number as two decimal digits inside its caption frame, then
 * verify a fixed block of program bytes (an anti-tamper guard).
 *
 * ROM 0x0EAC-0x0EEA. Grounding: [seen] (names.js ROUTINES 0x0EAC).
 *
 * ROLE IN THE MACHINE. Command 7 of the command table at 0x0BBC (its dispatch word is at 0x0BCA), run by the
 * foreground loop runCommandRingDrainLoop when that command comes off the ring. The round-start arm posts it
 * when ROUND_INTRO_PENDING is set (names.js: the round-start arm's entry, and 0x0BBC slot 7 = this routine). The number is ROUND_NUMBER (0xAD01) [seen], the unwrapped round count that keeps
 * climbing past the fifth era, which is why it can need two digits — and why 100 and above draw nothing.
 *
 * DRAWING. The caption frame (caption 0x0E) is painted first in the live pen colour, then the character
 * cursor is stepped back two cells onto the digit positions. Each digit is
 * painted by paintDigitDroppingLeadingZero (ROM 0x0EEB) in PEN_COLOUR (0xAD0C) [seen]; the tens may be dropped
 * as a leading zero, the ones never.
 *
 * THE CHECK. The 16 program bytes at 0x1748 (the start of holdCopyrightThenEraseTheCoinInvitation, read as
 * data) are added onto a seed of 0x8C; on the genuine image the total wraps to exactly zero (checked against
 * the ROM image). The ROM sends any other total to 0x2509 (`jp nz`); the port throws instead of running on.
 *
 * LIVE-OUT: memory.
 */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { u8 } from "../../../core/int.js";
import { PEN_COLOUR, ROUND_NUMBER, holdCopyrightThenEraseTheCoinInvitation_ADDR } from "./names.js";
import { drawCaptionInPenColour } from "./drawCaptionInPenColour.js";
import { retreatCharCursor } from "./retreatCharCursor.js";
import { advanceCharCursor } from "./advanceCharCursor.js";
import { paintDigitDroppingLeadingZero } from "./paintDigitDroppingLeadingZero.js";

/** The caption frame the digits sit in (ROM `ld a,0x0e; call 0x0c0f`). */
const FIELD_CAPTION = 0x0e;
/** The guard: B = 0x10 bytes from 0x1748 added onto C = 0x8C (ROM `ld bc,0x108c`). */
const CHECK_LEN = 16;
const CHECK_SEED = 0x8c;

export function drawRoundNumberCaption(m) {
  const { mem8 } = m;
  // Two digits only: a round number of 100 or more draws nothing (ROM `cp 0x64; ret nc`).
  const value = mem8[ROUND_NUMBER];
  if (value >= 100) return;

  // Paint the frame, then step the cursor it leaves back two cells (ROM `rst 0x28` twice) onto the
  // tens position.
  let [, cursor] = drawCaptionInPenColour(m, FIELD_CAPTION);
  cursor = retreatCharCursor(m, cursor);
  cursor = retreatCharCursor(m, cursor);

  const colour = mem8[PEN_COLOUR];
  // The tens paint is called with allowance 1: both its paths (paint-and-spend, or drop-and-decrement)
  // leave the allowance at 0, so the ones digit inherits 0 and a trailing zero always shows. Each
  // paint hands back the cursor it leaves, and the ROM's `rst 0x20` steps it one cell on.
  [, cursor] = paintDigitDroppingLeadingZero(m, Math.floor(value / 10), 1, colour, cursor);
  cursor = advanceCharCursor(m, cursor);
  [, cursor] = paintDigitDroppingLeadingZero(m, value % 10, 0, colour, cursor);
  advanceCharCursor(m, cursor);

  // The anti-tamper guard (ROM 0x0EDB-0x0EE7).
  let checksum = CHECK_SEED;
  for (let i = 0; i < CHECK_LEN; i++) checksum = u8(checksum + mem8[holdCopyrightThenEraseTheCoinInvitation_ADDR + i]);
  if (checksum !== 0) throw new NotImplemented("drawRoundNumberCaption: the guarded program block does not sum to zero, so the image is tampered; a genuine image never does");
}
