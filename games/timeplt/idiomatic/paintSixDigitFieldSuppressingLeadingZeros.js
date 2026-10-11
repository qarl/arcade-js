// SPDX-License-Identifier: GPL-3.0-only
/** paintSixDigitFieldSuppressingLeadingZeros — paint a six-digit field from three packed bytes, stepping the pointer BACK through
 * them a byte at a time while the cursor runs on a cell at a time. The first four digits go
 * through the suppressing painter and share one flag, cleared here, so the field's leading zeros
 * are decided across all four rather than pair by pair; the last two are painted plainly, so no
 * flag can blank them. The colour, the first cell and the byte to start from all arrive from the
 * caller. The pointer, the cursor, the shared flag and the pen thread as explicit values.
 * LIVE-OUT: the cells painted, the cursor six cells on,
 * and the pointer two bytes back.
 * ROM 0x0D73-0x0D80. Grounding: [seen] (names.js ROUTINES 0x0D73). */

import { u16 } from "../../../core/int.js";
import { paintTwoUnsuppressedDigitsFromByte } from "./paintTwoUnsuppressedDigitsFromByte.js";
import { paintTwoSuppressedDigitsFromByte } from "./paintTwoSuppressedDigitsFromByte.js";

export function paintSixDigitFieldSuppressingLeadingZeros(m, source = m.regs.hl, cursor = m.regs.de, pen = m.regs.c) {
  // the flag starts cleared so the four suppressed digits decide their leading zeros together.
  const first = paintTwoSuppressedDigitsFromByte(m, source, 0, cursor, pen);
  const second = paintTwoSuppressedDigitsFromByte(m, u16(source - 1), first.flag, first.cell, pen);
  const last = u16(source - 2);
  const end = paintTwoUnsuppressedDigitsFromByte(m, last, second.cell, pen);

  // The pointer two bytes back and the cursor six cells on: returned, and left in HL and DE as the ROM leaves them.
  return { source: (m.regs.hl = last), cursor: (m.regs.de = end) };
}
