// SPDX-License-Identifier: GPL-3.0-only
/** derailIntoMotherShipWreckCountdown — a misaligned entry into the Mother-Ship's wreck countdown, taken only as
 * an anti-tamper derail. It is reached on exactly two transfers, each behind a guard that a genuine
 * image always passes: a caption glyph read off the screen that is not the one a genuine image
 * paints there, and a tamper-witness pair that does not hold the values a genuine image plants and
 * copies into it. Entered here, an early `pop af` (0x45A1, after four instructions that only disturb registers) eats the caller's return slot as data, a
 * second pop follows one byte out of step, and every exit then returns through a slot read at an odd
 * offset from the frame — so control is destroyed rather than handed back. There is no faithful
 * transcription of that as a routine; the Mother-Ship's genuine wreck countdown is entered past this
 * prologue, at 0x45B3, and lives in loc_43f0.js (stepMotherShipWreckCountdown). So this raises where the derail would begin.
 * The 24 bytes 0x459B-0x45B2 are also caption record 17 (the word at 0x0C72 in the caption table at
 * 0x0C50): destination 0xA716, colour 0x13, twenty glyphs and the 0xB9 terminator at 0x45B2.
 * LIVE-OUT: none — it never returns.
 * ROM 0x459B-0x460D, 0x4623-0x4642 and 0x4646-0x4662. Grounding: [code] (names.js ROUTINES 0x459B). */

import { NotImplemented } from "../../../boards/timeplt/io.js";

export function derailIntoMotherShipWreckCountdown() {
  throw new NotImplemented(
    "derailIntoMotherShipWreckCountdown: a tamper guard failed and the original enters the Mother-Ship's wreck countdown " +
      "through a misaligned prologue that destroys the stack frame; a genuine image never takes this entry",
  );
}
