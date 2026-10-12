// SPDX-License-Identifier: GPL-3.0-only
/**
 * advanceCharCursor — step the character-cell cursor on to the next cell of the line being drawn.
 *
 * ROM 0x0020-0x0026 (loc_0020). Grounding: [seen] (names.js ROUTINES 0x0020).
 *
 * What it is: the one-cell "move right" of every text and digit drawer. The character plane is a
 * tilemap laid out in rows of thirty-two cells, so the cell that follows the current one ON SCREEN
 * is thirty-two addresses lower (one native row back), not one address on. The monitor is mounted
 * rotated (MAME's ROT90, clockwise): a decreasing native row maps to an increasing display column,
 * which is why subtracting a row's worth of cells reads as moving along a line of text.
 *
 * Role in the machine: paintTwoUnsuppressedDigitsFromByte draws a two-digit pair as high nibble,
 * step, low nibble, so this step is reading order; every base those drawers feed it lies inside
 * video RAM. Its exact inverse is retreatCharCursor (RST 0x28, +32), which paintDigitDroppingLeadingZero
 * calls on a blanked digit so that the drawer's following step nets to zero and the digit consumes no cell.
 *
 * Parameter: `cursor` — the 16-bit tilemap address of the cell just drawn (the DE pair in the ROM).
 *
 * LIVE-OUT: the stepped cursor, nothing else — no memory is read or written.
 */

import { u16 } from "../../../core/int.js";

export function advanceCharCursor(m, cursor = m.regs.de) {
  // The ROM does this as `ld a,e / sub 0x20 / ld e,a` and only when that borrows, `dec d` — a
  // byte-wide subtract with its borrow carried by hand into the high byte. Together that is exactly
  // a 16-bit "minus thirty-two", wrapped to sixteen bits, which is what u16 reproduces here.
  // The result is both returned and left in DE, where callers still written against the register
  // interface read the cursor back.
  return (m.regs.de = u16(cursor - 32));
}
