// SPDX-License-Identifier: GPL-3.0-only
/**
 * drainBothDeferredCellLists — one pass of the deferred cell machinery: blank what the last pass painted, paint what is
 * pending now, then COPY the pending list wholesale onto the erase list. Not a swap and not a double buffer: the copy runs
 * one way on every pass, and the two lists hold different jobs rather than alternating ones.
 * That copy is a straight byte copy of the pending list onto the erase list, as many bytes as the
 * pending cursor says are in use, cursor byte included — so it lands the pending count on top of
 * the erase cursor, and the line after replaces that with the same count plus a mark in the top
 * bit. The pending cursor is then parked on its own first entry. Where nothing was pending both
 * cursors are parked instead and no copy happens. A cursor of ZERO is not nothing pending: the
 * count is a block-copy length, and a length of zero means the whole address space.
 * LIVE-OUT: memory.
 *
 * ROM 0x5286-0x52A9 (frozen lift translated/loc_5286.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. Part of the first job of every vertical-blank service, "publish the display"
 * (mechanisms.md). Some drawing is not written straight into video RAM -- the player's shots, for
 * one, are character-cell blocks queued by queueTileStampForObject. The queuer appends four-byte
 * entries (address low, address high, glyph, attribute) to the pending list whose cursor is DEFERRED_WRITE_CURSOR (0xAE00, entries from 0xAE04). Once a frame this entry
 * takes back the previous pass's cells, paints the new ones, and records what it just painted so
 * the NEXT pass can take those back in turn. A cell queued once therefore shows for one pass and
 * is then blanked unless it is queued again.
 *
 * The two lists are not a double buffer: blankCellsPaintedLastPass walks the erase list at
 * DEFERRED_BLANK_CURSOR (0xAE80) and writes only the blank glyph into the character plane, leaving
 * colour alone, while paintDeferredCells walks the pending list and writes glyph AND colour. The
 * copy always runs 0xAE00 onto 0xAE80, never back.
 */

import { u8, u16 } from "../../../core/int.js";
import { blankCellsPaintedLastPass } from "./blankCellsPaintedLastPass.js";
import { emptyBothDeferredCellLists } from "./emptyBothDeferredCellLists.js";
import { paintDeferredCells } from "./paintDeferredCells.js";
import { DEFERRED_BLANK_CURSOR, DEFERRED_WRITE_CURSOR, DEFERRED_WRITE_LIST } from "./names.js";

// The pending cursor's low byte when it still points at its first entry (DEFERRED_WRITE_LIST).
const FIRST_ENTRY = DEFERRED_WRITE_LIST & 0xff;
const COPIED_MARK = 0x80;
const WHOLE_ADDRESS_SPACE = 0x10000;

export function drainBothDeferredCellLists(m) {
  const { mem8, mem16 } = m;
  // Take back what the last pass painted, then paint what is pending now (ROM `call 0x530e`,
  // `call 0x52d2`). The order matters: a cell queued on both passes is blanked and then painted
  // again within this one call.
  blankCellsPaintedLastPass(m);
  paintDeferredCells(m);

  // How far the pending list got: the low byte of its cursor (ROM `ld a,(0xae00)`), an offset
  // within the list's own page. Still at the first entry (`cp 0x04`) means nothing was queued this
  // pass, so both lists are simply reset to empty (a tail jump to 0x526a) and nothing is copied.
  const filled = mem8[DEFERRED_WRITE_CURSOR];
  if (filled === FIRST_ENTRY) {
    emptyBothDeferredCellLists(m);
    return;
  }

  // Copy the pending list, cursor and all, onto the erase list (ROM `ld c,a / ld b,0 / ldir` from
  // 0xAE00 to 0xAE80). The length is the cursor byte itself; a Z80 block copy of length zero runs
  // 65536 bytes, which is why a zero cursor becomes the whole address space here rather than no copy.
  const bytes = filled === 0 ? WHOLE_ADDRESS_SPACE : filled;
  for (let i = 0; i < bytes; i++) {
    mem8[u16(DEFERRED_BLANK_CURSOR + i)] = mem8[u16(DEFERRED_WRITE_CURSOR + i)];
  }

  // The copy put the pending count on the erase cursor; add the top-bit mark to it (ROM `add a,0x80
  // / ld (0xae80),a`). blankCellsPaintedLastPass masks that bit off before counting its entries.
  // Then park the pending cursor back on its first entry, DEFERRED_WRITE_LIST 0xAE04 (ROM `ld hl,0xae04 / ld (0xae00),hl`),
  // so the coming frame's game code queues into an empty list.
  mem8[DEFERRED_BLANK_CURSOR] = u8(filled + COPIED_MARK);
  mem16[DEFERRED_WRITE_CURSOR] = DEFERRED_WRITE_LIST;
}
