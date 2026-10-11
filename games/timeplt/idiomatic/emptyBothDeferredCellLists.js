// SPDX-License-Identifier: GPL-3.0-only
/** emptyBothDeferredCellLists — empty both lists by parking each cursor back on its own first
 * entry, four bytes past the head the cursor occupies. Nothing is read, so what the lists held
 * stops being reachable rather than going away.
 *
 * ROM 0x526A-0x5276 (frozen lift translated/loc_526a.js). Grounding: [seen] -- under MAME a write
 * tap by program counter saw this routine write the two heads equally often (names.js).
 *
 * Role in the machine: the character plane has two deferred cell lists, used to draw the player's
 * shots. The paint list (cursor DEFERRED_WRITE_CURSOR 0xAE00, entries from 0xAE04) holds cells to
 * paint at the next vertical blank; the blank list (cursor DEFERRED_BLANK_CURSOR 0xAE80, entries
 * from 0xAE84) holds last pass's cells to erase. Each cursor sits four bytes ahead of its own
 * entries, so a cursor pointing at its first entry means "empty" -- the sentinel both drains test
 * for. This is called at cold start by initColdStartRamThenSeedConfig, and by
 * drainBothDeferredCellLists as its branch for a pass when nothing was pending (mechanisms.md).
 *
 * LIVE-OUT: the two cursors, the second also in HL. */

import { DEFERRED_BLANK_CURSOR, DEFERRED_BLANK_LIST, DEFERRED_WRITE_CURSOR, DEFERRED_WRITE_LIST } from "./names.js";

export function emptyBothDeferredCellLists(m) {
  // Blank list first, then the paint list, in the ROM's order (`ld (0xae80),hl` then `ld (0xae00),hl`).
  m.mem16[DEFERRED_BLANK_CURSOR] = DEFERRED_BLANK_LIST;
  m.mem16[DEFERRED_WRITE_CURSOR] = DEFERRED_WRITE_LIST;
  // The ROM leaves 0xAE04 in HL from the last store; it is handed back the same way.
  return (m.regs.hl = DEFERRED_WRITE_LIST);
}
