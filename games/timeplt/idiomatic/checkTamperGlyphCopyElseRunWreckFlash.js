// SPDX-License-Identifier: GPL-3.0-only
/** checkTamperGlyphCopyElseRunWreckFlash — on any call that finds a watched pair of cells disagreeing, step a counter the caller points at down,
 * seat two shape codes and two attribute bytes (read as a sprite entry) into one object slot, ask for the Mother-Ship award
 * sound while the player is live, and post a 3,000-point score award (ring command 4, award entry 13). When the pair still agrees it does nothing.
 * LIVE-OUT: memory.
 *
 * ROM 0x460E-0x4645. Grounding: [seen] (names.js ROUTINES 0x460e).
 *
 * ROLE IN THE MACHINE. startTwoPlayerGame runs this at a two-player start. The pair it watches is
 * an anti-tamper witness: TAMPER_GLYPH_COPY 0xAB43 [seen] holds a copy of the glyph (0x7C) taken
 * earlier from the character cell TAMPER_GLYPH_SOURCE_CELL 0xA67C, and a genuine image keeps the
 * two equal. Under MAME both held 0x7C at every captured two-player start, so the routine returned
 * without acting (mechanisms.md). What the acting arm is for -- which counter and which slot the
 * caller's pointers name there -- is recorded as open in mechanisms.md; mechanisms.md reads it as
 * stamping a Mother-Ship flash into whatever slot is at hand and paying a Mother-Ship award.
 *
 * PARAMETERS: counterBase, slotBase = the pointers the acting arm steps and seats through (the ROM's
 * IX and IY). The ROM's caller (startTwoPlayerGame) loads neither, so they hold whatever earlier
 * routines left there. A direct caller therefore has no pointer to give and passes null for both;
 * the acting arm then refuses rather than invent one.
 */

import { u16 } from "../../../core/int.js";
import { requestMotherShipAwardSound } from "./requestMotherShipAwardSound.js";
import { postCommand } from "./postCommand.js";
import { PLAYER_STATE, TAMPER_GLYPH_COPY, TAMPER_GLYPH_SOURCE_CELL } from "./names.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";

// Offsets into the slot the caller's IY points at. Read as a sprite entry, +0x01 and +0x03 are the
// two tiles' shape codes and +0x30 and +0x32 their attribute bytes -- the same four stores, with the
// same values (0xFE/0xFD, 0x6C/0x6C), as the Mother-Ship's flash at 0x4623, where this arm lands.
const SLOT_SHAPE_A = 0x01;
const SLOT_SHAPE_B = 0x03;
const SLOT_ATTRIBUTE_A = 0x30;
const SLOT_ATTRIBUTE_B = 0x32;

export function checkTamperGlyphCopyElseRunWreckFlash(m, counterBase = m.regs.ix, slotBase = m.regs.iy) {
  const { mem8 } = m;
  // Step 1 -- the witness check. Equal cells (the genuine case) end the routine here.
  if (mem8[TAMPER_GLYPH_COPY] === mem8[TAMPER_GLYPH_SOURCE_CELL]) return;

  // Step 2 -- the acting arm. In the ROM the mismatch jump lands at 0x4643, which jumps back to
  // 0x461B and executes eight bytes of an animation table as `sub` instructions; they only
  // disturb A and the flags, and execution then reaches the real stores below at 0x4623.
  // Count the caller's counter down by one, then seat the four fixed bytes into the slot.
  if (counterBase === null || slotBase === null) {
    throw new NotImplemented(
      "checkTamperGlyphCopyElseRunWreckFlash: the anti-tamper witness pair disagrees, so the acting arm would step " +
        "the pointers the caller left in IX and IY -- a direct caller carries none; the oracle's measured two-player dispatch arrived with the pair equal and IX in ROM, where the frozen routine's own first store would fault too",
    );
  }
  mem8[counterBase] = mem8[counterBase] - 1;
  mem8[u16(slotBase + SLOT_SHAPE_A)] = 0xfe;
  mem8[u16(slotBase + SLOT_SHAPE_B)] = 0xfd;
  mem8[u16(slotBase + SLOT_ATTRIBUTE_A)] = 0x6c;
  mem8[u16(slotBase + SLOT_ATTRIBUTE_B)] = 0x6c;

  // Step 3 -- only while the player is live (PLAYER_STATE 0xA800 [seen] = 0xFF) ask for the sound
  // whose code is the program byte at 0x49EE, then queue command 0x04 with argument 0x0D in the
  // command ring (ROM `ld de,0x040d` / `jp 0x0038`).
  if (mem8[PLAYER_STATE] === 0xff) requestMotherShipAwardSound(m);
  return postCommand(m, 0x04, 0x0d);
}
