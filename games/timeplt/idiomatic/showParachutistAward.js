// SPDX-License-Identifier: GPL-3.0-only
/** showParachutistAward — put an object into a fixed state, ask for the sound that goes with it, and dress its
 * sprite entry for that state. The shape comes from a four-entry table in the program image chosen
 * by a byte of the object's own record; an index at or past the end of that table does NOT read on
 * past it — a single fixed shape is used instead, which is what keeps the lookup inside the table.
 * Either way the entry's +0x30 byte takes one fixed value. LIVE-OUT: memory.
 *
 * ROM 0x4809-0x482C. Grounding: [seen] (names.js ROUTINES 0x4809).
 *
 * ROLE IN THE MACHINE. The parachutist is the figure the player collects for a bonus. Touching it
 * sets its state byte to 0xF0; on its next turn runParachutistSlot hands the slot here with the
 * record at PARACHUTIST_RECORD (0xA8F0) and its sprite entry. This starts the slot's exit: the
 * state is put at the top of the dying countdown and the parachutist's sprite is swapped for the
 * award glyph, chosen by the record's +7 byte, PARACHUTIST_RUNG 0xA8F7 -- how many rescue awards
 * this life has already paid. The first four rungs each show their own award glyph (ROM 0x482D
 * holds F9 FC 8D 8E); every later rung shows 0x8F. The count then runs down one per pass and the
 * score itself is posted later by postNextParachutistBonus (mechanisms.md).
 */

import { u16 } from "../../../core/int.js";
import { fetchTableByte } from "./fetchTableByte.js";
import { requestParachutistAwardSound } from "./requestParachutistAwardSound.js";
import { PARACHUTIST_AWARD_SHAPE_TABLE } from "./names.js";

// Record layout used here: +0 the state byte, +7 the rung.
const STATE_IN_RECORD = 0;
const INDEX_IN_RECORD = 7;
// 0x3B is the top of the 0x01-0x3B dying-countdown band.
const STATE_CODE = 0x3b;
const SHAPE_TABLE_LENGTH = 4;
const SHAPE_PAST_THE_END = 0x8f;
// Sprite entry layout used here: +0x01 the shape (tile) byte, +0x30 the second fixed byte.
const SHAPE_IN_ENTRY = 1;
const SECOND_BYTE_IN_ENTRY = 48;
const SECOND_BYTE = 0x6c;

export function showParachutistAward(m, record = m.regs.ix, sprite = m.regs.iy) {
  const { mem8 } = m;
  // Step 1 -- restamp the state to the top of the dying countdown, then ask for the award sound
  // (program byte 0x079B, queued only while a game is being played).
  mem8[u16(record + STATE_IN_RECORD)] = STATE_CODE;
  requestParachutistAwardSound(m);

  // Step 2 -- pick the award glyph. The rung is read before anything steps it, so a life's first
  // award shows the bottom rung. Rungs 0-3 index the table; 4 and above take the fixed glyph
  // (ROM `cp 0x04` / `jp nc,0x4824`).
  const index = mem8[u16(record + INDEX_IN_RECORD)];
  let shape = SHAPE_PAST_THE_END;
  if (index < SHAPE_TABLE_LENGTH) {
    shape = fetchTableByte(m, PARACHUTIST_AWARD_SHAPE_TABLE, index);
  }
  // Step 3 -- dress the sprite entry: the chosen glyph, and 0x6C in the +0x30 byte on both arms.
  mem8[u16(sprite + SHAPE_IN_ENTRY)] = shape;
  mem8[u16(sprite + SECOND_BYTE_IN_ENTRY)] = SECOND_BYTE;
}
