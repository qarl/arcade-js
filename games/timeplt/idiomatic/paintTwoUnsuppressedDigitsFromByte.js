// SPDX-License-Identifier: GPL-3.0-only
/** paintTwoUnsuppressedDigitsFromByte — paint the two decimal digits packed into one byte, the high one first, stepping the
 * cursor one cell on after each. The byte is read twice from the pointer the caller is walking,
 * shifted down for the high digit and taken whole for the low; the colour and the cursor arrive
 * as explicit values and the cursor is handed back. No suppression flag is involved, so this
 * painter neither takes nor touches it. Nothing threads through the register file here.
 * LIVE-OUT: the four cells painted, and the cursor two cells on.
 * ROM 0x0D81-0x0D8F. Grounding: [seen] (names.js ROUTINES 0x0D81). */

import { advanceCharCursor } from "./advanceCharCursor.js";
import { paintUnsuppressedDigit } from "./paintUnsuppressedDigit.js";

const HIGH_DIGIT_SHIFT = 4;

export function paintTwoUnsuppressedDigitsFromByte(m, source = m.regs.hl, cursor = m.regs.de, pen = m.regs.c) {
  const { mem8 } = m;

  // the cursor is stepped one cell on after each digit.
  const afterHigh = advanceCharCursor(m, paintUnsuppressedDigit(m, mem8[source] >> HIGH_DIGIT_SHIFT, pen, cursor));
  return advanceCharCursor(m, paintUnsuppressedDigit(m, mem8[source], pen, afterHigh));
}
