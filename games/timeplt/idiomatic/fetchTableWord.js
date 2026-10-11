// SPDX-License-Identifier: GPL-3.0-only
/** fetchTableWord — pick one entry out of a table of two-byte entries and hand back the word held
 * there. The entry number is doubled to reach its entry, and that doubling wraps at eight bits,
 * so number 128 selects the same entry as number 0. LIVE-OUT: the word, returned and left
 * standing for the caller, which reads it as a pointer or as a pair of bytes. Nothing is written.
 *
 * ROM 0x0010-0x0016 (frozen lift loc_0010) — the Z80 restart vector RST 0x10. Grounding: [seen]
 * (names.js ROUTINES 0x0010).
 *
 * Role in the machine: one of a small family of table helpers sitting on the restart vectors at
 * the bottom of the ROM, so a caller reaches them with a one-byte `rst` instead of a three-byte
 * `call`: offsetAddress (RST 0x18) adds a byte offset to an address, fetchTableByte (RST 0x08)
 * reads a byte table, and this one reads a word table. Its wide sibling fetchWideTableWord
 * (0x018C, a plain call) keeps the doubling's carry, so its tables may hold more than 128
 * entries; this one is the default where 128 is enough. One use: the ERA_RUNG_SETTINGS_POINTER_TABLE
 * lookup (0x1B04), which turns an era and difficulty rung into a pointer to a settings row.
 *
 * Parameters: `index` — the entry number; `table` — the table's base address.
 * The ROM hands the word back in DE (low byte E, high byte D). It also leaves HL two bytes past
 * the entry's start (names.js: "the address past it"); this form sets DE and returns the word,
 * and HL is left where offsetAddress put it, at the entry itself.
 */

import { u8 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";

export function fetchTableWord(m, index = m.regs.a, table = m.regs.hl) {
  const { regs, mem16 } = m;
  /* Reach the entry: `add a,a` doubles the number inside the 8-bit accumulator — so the carry out
   * of bit 7 is lost (u8) — then `rst 0x18` (offsetAddress) adds that byte to the table base
   * with a full 16-bit carry. */
  const entryAddress = offsetAddress(m, table, u8(index + index));
  /* Read the two bytes little-endian (ROM ld e,(hl) / inc hl / ld d,(hl)). */
  const word = mem16[entryAddress];
  // Handed back in DE as the ROM does, and returned.
  return (regs.de = word);
}
