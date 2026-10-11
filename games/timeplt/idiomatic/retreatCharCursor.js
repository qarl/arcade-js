// SPDX-License-Identifier: GPL-3.0-only
/**
 * retreatCharCursor — step the character-cell cursor one cell back along the line being drawn, the
 * inverse of the advance vector.
 *
 * WHAT IT IS: ROM routine 0x0028 [seen], a restart vector, so text painters reach it with a one-byte
 * `rst 0x28`. The cursor is a video-RAM address; the character plane is thirty-two cells to a row, so
 * adding 0x20 moves one row down in video RAM. The monitor is rotated (ROT90), and an increasing native
 * row is a DECREASING display column -- so on the glass this is one character to the left, one place
 * back along a line of text.
 *
 * ROLE IN THE MACHINE: it is the exact inverse of advanceCharCursor on the same axis.
 * paintDigitDroppingLeadingZero calls it on a dropped leading zero and returns, so the caller's following
 * advance nets to zero and a suppressed leading zero consumes no cell.
 *
 * PARAMETERS: `cursor` is the current cell address (the ROM keeps it in DE).
 * LIVE-OUT: the cursor, nothing else.
 */

import { u16 } from "../../../core/int.js";

export function retreatCharCursor(m, cursor = m.regs.de) {
  // One row on in video RAM. The ROM adds 0x20 to the low byte E and carries into D only when it
  // overflows (`add a,0x20` / `ret nc` / `inc d`) -- a sixteen-bit add, which is what this is.
  return (m.regs.de = u16(cursor + 32));
}
