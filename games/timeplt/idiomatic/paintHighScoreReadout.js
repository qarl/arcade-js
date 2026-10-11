// SPDX-License-Identifier: GPL-3.0-only
/** paintHighScoreReadout — fix the three arguments of the six-digit packed-decimal readout printer and fall
 * straight into it: the tally to print, taken from its highest byte because the printer walks
 * downward; the cell its leftmost digit lands in; and the colour every digit is given. Choosing
 * that triple is the whole of this entry, and whatever a caller held in those registers is
 * discarded. LIVE-OUT: memory — the digits and their colours, written by the printer. */
//
// ROM 0x0D6B-0x0D72, falling into 0x0D73 (lift: translated/loc_0d6b.js). Grounding tag in names.js
// ROUTINES: [seen].
//
// ROLE IN THE MACHINE. The single displayed high score is kept as three packed-decimal bytes
// (0xA98B/0xA98C/0xA98D, two digits per byte). Whenever it has to be shown -- names.js records
// armAttractScreenShowingHighScore printing it on the attract screen, and awardScoreToPlayer
// repainting the affected scores after an award -- this entry points the shared six-digit printer at
// it. names.js calls it the printer's third fixed triple: other entries point the same printer at
// other tallies.
//
// LIVE-OUT: the six digit cells from 0xA641 onward in the character plane and their colour cells;
// nothing is returned.

import { paintSixDigitFieldSuppressingLeadingZeros } from "./paintSixDigitFieldSuppressingLeadingZeros.js";
import { HIGH_SCORE_HI, HIGH_SCORE_READOUT_BASE } from "./names.js";

// The colour code every digit is painted with (`ld c,0x10` at 0x0D71).
const DIGIT_COLOUR = 0x10;

export function paintHighScoreReadout(m) {
  // Seat the triple and fall straight into the printer at 0x0D73:
  //   source -- HIGH_SCORE_HI (0xA98D; tagged [seen] in names.js), the MOST significant
  //             byte, because the printer walks its source pointer backwards (`ld hl,0xa98d`);
  //   target -- HIGH_SCORE_READOUT_BASE (0xA641), the leftmost digit's cell (`ld de,0xa641`);
  //   colour -- DIGIT_COLOUR.
  // The printer blanks leading zeros in the first four digits and always shows the last two.
  return paintSixDigitFieldSuppressingLeadingZeros(m, HIGH_SCORE_HI, HIGH_SCORE_READOUT_BASE, DIGIT_COLOUR);
}
