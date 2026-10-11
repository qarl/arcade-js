// SPDX-License-Identifier: GPL-3.0-only
/** paintLabelledNumericReadoutColumn — paint one labelled numeric readout as a single column climbing the tile plane: a
 * three-tile rank label taken from a record table by the source's lead byte (the rank), a six-digit field
 * after it, and a three-tile suffix, every cell paired with the caller's pen colour in the
 * colour plane. The column is walked upward a cell at a time and the source is read forward past
 * its lead byte, its digit bytes and its suffix bytes. LIVE-OUT: memory only — the cursor, source
 * pointer and scratch bytes the body leaves in registers are all re-seated by the sole caller
 * before its next column, so they are dead after return. */
//
// ROM 0x4C1F-0x4C74 (lift: translated/loc_4c1f.js). Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. This paints one line of the high-score table. Its caller,
// paintFiveLabelledNumericReadouts (0x4BDC, [seen]), runs it five times, once per table record: each
// time with `source` on one of five source records at 0xAB08 (stride 8), `cursor` on that record's first
// tile-plane cell (from 0xA711, stride 2), and `pen` its colour. names.js lays each record out as
// +0 rank, +1..+3 score (packed decimal, lo/mid/hi), +4..+6 initials and +7 a pad byte (high-score group, [seen]);
// read that way, one call paints: a three-tile label chosen by the rank byte, the six-digit score,
// then three name tiles. The screen is rotated, so on the character plane the "line" runs as one
// column, walked a cell at a time by advanceCharCursor (`rst 0x20`, DE -= 0x20).
//
// LIVE-OUT: memory only -- the tile cells and their colour cells.

import { advanceCharCursor } from "./advanceCharCursor.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { paintSixDigitFieldSuppressingLeadingZeros } from "./paintSixDigitFieldSuppressingLeadingZeros.js";
import { u8, u16 } from "../../../core/int.js";
import { HIGH_SCORE_RANK_LABEL_TABLE } from "./names.js";

// Each rank-label record in HIGH_SCORE_RANK_LABEL_TABLE (ROM 0x4CB4) is three tile codes; the lead byte
// times 3 (`add a,a` / `add a,(hl)`) indexes it.
const RECORD_STRIDE = 3;
const COLOUR_PLANE_CELL = 0x04 << 8; // clearing bit 2 of the cursor's high byte pairs the tile cell with its colour cell
// Gaps along the column, in cell steps of 0x20: after the label the cursor moves on 0x80 (four
// cells: `ld hl,0xff80` / `add hl,de`) to where the digits start, and after the digits a further 0x60
// (three cells: `ld hl,0xffa0` / `add hl,de`) to where the suffix starts.
const PICTOGRAM_TO_FIELD = 0x80;
const FIELD_TO_SUFFIX = 0x60;

/** stamp one tile into a tile-plane cell and pair its colour-plane cell with the pen. */
// (The ROM's `ld (de),a` / `res 2,d` / `ld a,c` / `ld (de),a` / `set 2,d` group, repeated for every
// cell: each colour cell sits 0x400 below its tile cell.)
function stamp(m, tile, cell, pen) {
  const { mem8 } = m;
  mem8[cell] = tile;
  mem8[cell & ~COLOUR_PLANE_CELL] = pen;
}

export function paintLabelledNumericReadoutColumn(m, source = m.regs.hl, cursor = m.regs.de, pen = m.regs.c) {
  const { mem8 } = m;

  // STEP 1 -- THE LABEL (0x4C1F-0x4C42).
  // rank label: three consecutive tiles of the record the source's lead byte selects (stride 3)
  // fetchTableByte (`rst 0x08`) returns the first code and leaves the table pointer on the record, so
  // the next two codes are the bytes after it.
  const index = u8(mem8[source] * RECORD_STRIDE);
  const record = u16(HIGH_SCORE_RANK_LABEL_TABLE + index);
  stamp(m, fetchTableByte(m, HIGH_SCORE_RANK_LABEL_TABLE, index), cursor, pen);
  cursor = advanceCharCursor(m, cursor);
  stamp(m, mem8[u16(record + 1)], cursor, pen);
  cursor = advanceCharCursor(m, cursor);
  stamp(m, mem8[u16(record + 2)], cursor, pen);

  // STEP 2 -- THE NUMBER (0x4C45-0x4C4B, call 0x0D73).
  // six-digit field: move the cursor four cells on (0x80) from the last label cell and read the digits from the source.
  // The printer is handed source+3 -- the field's most significant byte -- and steps its pointer BACK
  // through the three packed bytes, blanking leading zeros except in the last two digits.
  // the printer takes the source pointer, the cursor and the pen as arguments and hands the pointer
  // and cursor back.
  const { source: fieldPtr, cursor: fieldCursor } = paintSixDigitFieldSuppressingLeadingZeros(m, u16(source + 3), u16(cursor - PICTOGRAM_TO_FIELD), pen);
  cursor = u16(fieldCursor - FIELD_TO_SUFFIX);
  const suffix = u16(fieldPtr + 3);

  // STEP 3 -- THE SUFFIX (0x4C4F-0x4C74).
  // suffix: three more tiles, read forward from where the field left the source pointer
  // The printer leaves the pointer on source+1, so +3 lands on source+4, the byte after the field.
  stamp(m, mem8[suffix], cursor, pen);
  cursor = advanceCharCursor(m, cursor);
  stamp(m, mem8[u16(suffix + 1)], cursor, pen);
  cursor = advanceCharCursor(m, cursor);
  stamp(m, mem8[u16(suffix + 2)], cursor, pen);
}
