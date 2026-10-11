// SPDX-License-Identifier: GPL-3.0-only
/** isScoreBelow — answer whether one three-byte number is below another. Both are read most
 * significant byte first, from the two addresses given and DOWNWARD, and the first byte that
 * differs settles it; all three equal counts as not below. The answer is the whole product —
 * nothing is written. The ROM leaves it in carry; its one reader, fileScoreIntoHighScoreTable,
 * takes the return instead (its one call, at 0x4CD6).
 * LIVE-OUT: the boolean.
 *
 * ROM 0x4D2B-0x4D39 (frozen lift translated/loc_4d2b.js). Grounding: [seen] (names.js ROUTINES 0x4d2b).
 *
 * Role in the machine: the comparison step of the high-score insertion sort. Its only caller,
 * fileScoreIntoHighScoreTable, walks the five eight-byte records of the high-score table top-down,
 * asks this for each whether the finished player's score is below that record's, and inserts the new
 * score at the first record it is NOT below (mechanisms.md, "The high-score table and initials entry").
 * Under MAME it was dispatched five times in one frame at game over, the candidate pointer on the
 * active player's score and the standing pointer walking 0xAB0B at a stride of eight (names.js "why").
 *
 * Parameters: candidate — address of the HIGH byte of the score being filed (the ROM hands it in DE);
 * standing — address of the HIGH byte of a standing table score (in HL). Each score is three packed
 * bytes stored low-to-high in memory, so reading from the given address downward goes most
 * significant first.
 */

import { u16 } from "../../../core/int.js";

// A score is three bytes (the ROM's `ld c,0x03` loop count).
const BYTES = 3;

export function isScoreBelow(m, candidate = m.regs.de, standing = m.regs.hl) {
  const { mem8 } = m;
  // Equal all the way down means "not below", so start from false.
  let below = false;
  // Compare byte by byte from the most significant end. The ROM's `ld a,(de) / cp (hl)` returns
  // with carry set (`ret c`) the moment the candidate byte is smaller, jumps out with carry clear on
  // any other difference (`jr nz`), and otherwise steps both pointers down (`dec de / dec hl`) --
  // so the first differing byte decides, exactly as ordinary number comparison does.
  for (let i = 0; i < BYTES; i++) {
    const candidateByte = mem8[u16(candidate - i)];
    const standingByte = mem8[u16(standing - i)];
    if (candidateByte !== standingByte) {
      below = candidateByte < standingByte;
      break;
    }
  }
  // In the ROM the answer is the carry flag: set when below, cleared by `scf / ccf` otherwise.
  return below;
}
