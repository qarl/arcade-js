// SPDX-License-Identifier: GPL-3.0-only
/** checkTheCopyrightLineColoursOrDerail — read the colour of thirteen cells along one line and derail if any of them has been
 * changed. It starts at the caption's own first cell and follows it in the same direction the
 * caption is painted, a fixed stride each time; every cell must hold one of exactly two colours —
 * the two the caption's line is painted and flashed in, so on a genuine image the walk always comes
 * out clean. The first cell holding anything else ends the walk on a transfer into a caption record
 * that merely decodes as instructions: it steps the stack pointer by one and pops misaligned words,
 * so the frame unwinds out of step and control is destroyed rather than reported. That arm has no faithful
 * transcription as a routine, so it raises where the transfer would land. Thirteen good cells
 * simply return: neither caller's continuing path reads what the walk leaves in its registers -- each
 * reloads the accumulator, pointer, stride and flags before use and neither reads the count -- so
 * all of it dies here. LIVE-OUT: memory only (nothing on the clean exit).
 *
 * ROM 0x19DA-0x19EF (frozen lift translated/loc_19da.js). Grounding: [seen].
 *
 * Role in the machine: an anti-tamper check on the copyright caption. Two static call sites reach
 * it (`call 0x19da` at 0x176A and at 0x1797), from paintReadoutsThenSampleWitnessOrDerail
 * and holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail respectively.
 *
 * Why these cells and these two colours (names.js "why"): the copyright line's record, reached
 * through the caption table at 0x0C50 (first word 0x086B), paints thirteen glyphs from 0xA6BC with a
 * -32 cursor step, so its colour twins (address & ~0x0400) are 0xA2BC, 0xA29C ... 0xA13C -- the
 * cells walked here. The line has TWO records carrying the same destination and glyphs and differing
 * only in the colour byte: 0x10 in the record at 0x086B and 0x05 in the record at 0x4900. Those are
 * exactly the two accepted values, so a genuine line in either state passes.
 *
 * The derail target 0x49FA is CAPTION RECORD 4 -- destination 0xA6EE,
 * colour 0x14, seventeen glyphs and a 0xB9 terminator at 0x4A0E -- text, not a routine. */

import { u16 } from "../../../core/int.js";
import { COPYRIGHT_LINE_FIRST_COLOUR_CELL } from "./names.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";

// Thirteen cells: the copyright line's glyph count (ROM `ld b,0x0d`).
const CELLS = 13;
// One cell along the line: ROM `ld de,0xffe0`, -0x20, the same step advanceCharCursor paints with.
const STRIDE_BACK = -0x20;
// The two colour bytes of the line's two records (ROM `cp 0x10` then `cp 0x05`).
const EITHER_COLOUR = [0x10, 0x05];

export function checkTheCopyrightLineColoursOrDerail(m) {
  const { mem8 } = m;
  let cell = COPYRIGHT_LINE_FIRST_COLOUR_CELL;
  /* Walk the thirteen colour cells from 0xA2BC. `owed` mirrors the ROM's B counter (the djnz
   * count still owed). A cell holding either accepted colour falls through to the stride; any other
   * value takes the ROM's `jp nz,0x49fa`, a tail transfer that never returns here. */
  for (let owed = CELLS; owed > 0; owed--) {
    const colour = mem8[cell];
    if (!EITHER_COLOUR.includes(colour)) {
      /* Tampered image: the original now executes caption bytes as code, which cannot be
       * transcribed faithfully, so the port stops here and says why. A genuine image never
       * reaches this. */
      throw new NotImplemented(
        `checkTheCopyrightLineColoursOrDerail: cell ${CELLS - owed} of the copyright line holds colour ${colour}, ` +
          "so the image is tampered and the original runs a caption record as code; a genuine image never does",
      );
    }
    // Next cell of the line (`add hl,de`), wrapping at sixteen bits like HL.
    cell = u16(cell + STRIDE_BACK);
  }
}
