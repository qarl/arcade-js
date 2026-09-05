// SPDX-License-Identifier: GPL-3.0-only
// Message painter. The index picks a record (dest word + text) from the pointer table; its top two
// bits pick the mode: bit 7 blanks the text's cells, bit 6 records the cursor and clears the column,
// else each char draws its glyph. Text runs up the column (one row up per char) until the 63 end mark.
import { u16 } from "../../../core/int.js";
import {
  MESSAGE_PTR_TABLE,
  MESSAGE_DEST_PTR,
  MESSAGE_TEXT_PTR,
  MESSAGE_CURSOR_PTR,
  MESSAGE_SCROLL_ENABLE,
  VRAM_BASE,
  loc_4020,
} from "./names.js";

const TEXT_END = 63; // string terminator
const GLYPH_BASE = 48; // char code minus this maps to the tile code
const BLANK_TILE = 64; // painted over a message being erased
const CLEAR_TILE = 16; // painted down a freshly-armed column
const ROW_STRIDE = 32; // one screen row
const COLUMN_CELLS = 32; // cells in one column

export function loc_22f1(m, index = m.regs.a) {
  const { mem8, mem16 } = m;

  const record = mem16[MESSAGE_PTR_TABLE + (index & 0x1f) * 2];
  const dest = mem16[record];
  const text = u16(record + 2);

  if (index & 0x80) { // blank-fill: overwrite each char cell up the column
    for (let dst = dest, src = text; mem8[src] !== TEXT_END; src = u16(src + 1), dst = u16(dst - ROW_STRIDE)) {
      mem8[dst] = BLANK_TILE;
    }
    return;
  }

  if (index & 0x40) { // position setup: record the cursor, then clear the column
    mem16[MESSAGE_DEST_PTR] = dest;
    mem16[MESSAGE_TEXT_PTR] = text;

    const lo = dest & 0xff;
    const col = lo & 0x1f;
    const cursor = loc_4020 + col * 2;
    mem16[MESSAGE_CURSOR_PTR] = cursor;

    // pack the destination row into the top five bits
    const packed = (((dest >> 8) & 0x03) << 6 | lo >> 2) & 0xf8;

    let cell = VRAM_BASE + col;
    for (let i = 0; i < COLUMN_CELLS; i++, cell += ROW_STRIDE) mem8[cell] = CLEAR_TILE;

    mem8[cursor] = packed;
    mem8[MESSAGE_SCROLL_ENABLE] = 1;
    return;
  }

  // glyph draw: each char's tile code up the column
  for (let dst = dest, src = text; mem8[src] !== TEXT_END; src = u16(src + 1), dst = u16(dst - ROW_STRIDE)) {
    mem8[dst] = mem8[src] - GLYPH_BASE;
  }
}
