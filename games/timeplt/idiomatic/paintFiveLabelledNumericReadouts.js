// SPDX-License-Identifier: GPL-3.0-only
/** paintFiveLabelledNumericReadouts — paint five labelled numeric readouts up the tile plane, handing each one's source
 * record, cursor cell and pen colour to the column painter as explicit arguments. LIVE-OUT: memory-only. */
//
// ROM 0x4BDC-0x4C13 (five `ld hl / ld de / ld c / call 0x4c1f` groups); lift: translated/loc_4bdc.js.
// Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. The five sources are the five eight-byte records of the high-score table at
// HIGH_SCORE_TABLE_BASE (0xAB08..0xAB2F; per record +0 rank, +1..+3 score, +4..+6 initials, +7 a pad byte, per
// names.js), so the five readouts are the high-score table rows as they appear on screen. Two
// callers draw them: erasePenRouteThenOpenInitialsEntry, as it lays out the initials-entry screen,
// and paintReadoutsThenSampleWitnessOrDerail. Each row is painted by paintLabelledNumericReadoutColumn
// (0x4C1F) [seen] as one upward column of the tile plane: a three-tile rank label picked by the
// record's lead byte, a six-digit field, then a three-tile suffix, every cell given the row's pen.
// (The monitor is mounted ROT90 -- manifest.js -- so a column of the tile plane is a line of text on screen.)
//
// LIVE-OUT: the tile and colour cells of the five rows (0xA0F1-0xA719 per names.js); no register
// result -- the pen is dead after return.

import { paintLabelledNumericReadoutColumn } from "./paintLabelledNumericReadoutColumn.js";
import { HIGH_SCORE_REC1_BASE, HIGH_SCORE_REC2_BASE, HIGH_SCORE_REC3_BASE, HIGH_SCORE_REC4_BASE, HIGH_SCORE_TABLE_BASE, HIGH_SCORE_REC0_CURSOR, HIGH_SCORE_REC1_CURSOR, HIGH_SCORE_REC2_CURSOR, HIGH_SCORE_REC3_CURSOR, HIGH_SCORE_REC4_CURSOR } from "./names.js";

// One entry per row, top of the table first. The source steps by the table's record size (8) and the
// cursor by 2 tile cells; the pens are the ROM's literal `ld c,<pen>` bytes for each group
// (0x4BE2, 0x4BED, 0x4BF8, 0x4C03, 0x4C0E), giving each rank its own colour.
const READOUTS = [
  { source: HIGH_SCORE_TABLE_BASE, cursor: HIGH_SCORE_REC0_CURSOR, pen: 0x14 },
  { source: HIGH_SCORE_REC1_BASE, cursor: HIGH_SCORE_REC1_CURSOR, pen: 0x16 },
  { source: HIGH_SCORE_REC2_BASE, cursor: HIGH_SCORE_REC2_CURSOR, pen: 0x12 },
  { source: HIGH_SCORE_REC3_BASE, cursor: HIGH_SCORE_REC3_CURSOR, pen: 0x15 },
  { source: HIGH_SCORE_REC4_BASE, cursor: HIGH_SCORE_REC4_CURSOR, pen: 0x13 },
];

export function paintFiveLabelledNumericReadouts(m) {
  // The pen goes to each column as an explicit argument and on through its field; nothing reads it
  // after the return.
  for (const { source, cursor, pen } of READOUTS) {
    paintLabelledNumericReadoutColumn(m, source, cursor, pen);
  }
}
