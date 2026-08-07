// SPDX-License-Identifier: GPL-3.0-only
/** loc_4809 — put an object into a fixed state, ask for the sound that goes with it, and dress its
 * sprite entry for that state. The shape comes from a four-entry table in the program image chosen
 * by a byte of the object's own record; an index at or past the end of that table does NOT read on
 * past it — a single fixed shape is used instead, which is what keeps the lookup inside the table.
 * Either way the entry's second byte takes one fixed value. LIVE-OUT: memory. */

import { u16 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { loc_57ff } from "./loc_57ff.js";

const STATE_IN_RECORD = 0;
const INDEX_IN_RECORD = 7;
const STATE_CODE = 0x3b;
const SHAPE_TABLE = 0x482d;
const SHAPE_TABLE_LENGTH = 4;
const SHAPE_PAST_THE_END = 0x8f;
const SHAPE_IN_ENTRY = 1;
const SECOND_BYTE_IN_ENTRY = 48;
const SECOND_BYTE = 0x6c;

export function loc_4809(m, record = m.regs.ix, sprite = m.regs.iy) {
  const { regs, mem8 } = m;
  mem8[u16(record + STATE_IN_RECORD)] = STATE_CODE;
  loc_57ff(m);

  const index = mem8[u16(record + INDEX_IN_RECORD)];
  let shape = SHAPE_PAST_THE_END;
  if (index < SHAPE_TABLE_LENGTH) {
    regs.hl = SHAPE_TABLE;
    regs.a = index;
    shape = fetchTableByte(m);
  }
  mem8[u16(sprite + SHAPE_IN_ENTRY)] = shape;
  mem8[u16(sprite + SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}
