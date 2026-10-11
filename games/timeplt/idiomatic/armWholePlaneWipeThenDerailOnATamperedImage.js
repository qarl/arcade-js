// SPDX-License-Identifier: GPL-3.0-only
/** armWholePlaneWipeThenDerailOnATamperedImage — seat the whole-plane wipe's cursor and line count,
 * then fold a fixed run of the program image into one eight-bit total and hold it against a genuine
 * image's value. A mismatch hands control to a tail that unwinds the interrupt frame one word out of
 * step, returning to a saved register value; the wipe is armed either way. LIVE-OUT: memory only.
 *
 * ROM 0x019A-0x01B4 (frozen lift translated/loc_019a.js). Grounding: [seen] (names.js ROUTINES).
 *
 * ROLE IN THE MACHINE. Phase 0 of the sequence machine is the power-on wipe (mechanisms.md, "Phase 0:
 * the power-on wipe"). Its first arm, startTheWholePlaneWipeAndFoldAnImageBlockIntoThePhase (0x15E2),
 * calls this entry once; afterwards blankNextLine (0x01C2) erases one line of the character plane
 * per frame, reading the two cells seated here, until the count reaches zero.
 *
 * WHY "WHOLE PLANE". blankNextLine walks a line in steps of 32 cells and then moves the cursor on by
 * ONE cell, so a cursor at the plane's first cell (CHAR_PLANE_BASE 0xA400) and a count of 32 lines
 * covers the whole 32 x 32 plane, 0xA400-0xA7FF, exactly.
 *
 * WHY A CHECKSUM HERE. Most arms of sequence phases 0-2 carry an image fold like this one
 * (mechanisms.md, "Tamper checks"); this one is unrelated to the wipe and gates nothing above
 * it -- the wipe is armed first, whatever the fold says. The folded run, 0x4BA5-0x4C94, starts at the code of loadDefaultHighScores (0x4BA5), read
 * here as data.
 */

import { u8, u16 } from "../../../core/int.js";
import { BLANK_LINES_LEFT, BLANK_LINE_CURSOR, loadDefaultHighScores_ADDR, CHAR_PLANE_BASE } from "./names.js";
import { loc_0167 } from "./loc_0167.js";

// Lines the wipe must blank: the plane is 32 lines of 32 cells (ROM `ld a,0x20` at 0x01A0).
const WHOLE_PLANE = 0x20;

// The fold covers 240 bytes (ROM `ld b,0xf0`) and a genuine image sums to 0x11 (ROM `sub 0x11`).
const CHECKED_BYTES = 0xf0;
const GENUINE_TOTAL = 0x11;

export function armWholePlaneWipeThenDerailOnATamperedImage(m) {
  const { mem8, mem16 } = m;
  // Arm the wipe (ROM 0x019A-0x01A5): the cursor on the plane's first cell, the count at a whole
  // plane. Nothing is blanked here; the wipe's own step does that one line per frame.
  mem16[BLANK_LINE_CURSOR] = CHAR_PLANE_BASE;
  mem8[BLANK_LINES_LEFT] = WHOLE_PLANE;

  // The tamper test (ROM 0x01A5-0x01B1): an eight-bit ADD of the 240 program bytes from 0x4BA5,
  // wrapping at 256 (`add a,(hl) / inc hl / djnz`). A genuine image comes to exactly 0x11.
  // On a mismatch the ROM does `call nz,0x0167`, and 0x0167 is not a routine but a caption record
  // (caption record 9). Run as code it drops two stack words, falls into the interrupt epilogue
  // one word out of step and returns to a saved register value -- the machine is derailed rather
  // than told. loc_0167 stands in for that landing; on a genuine image the call is never taken
  // and this simply returns.
  let total = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) total = u8(total + mem8[u16(loadDefaultHighScores_ADDR + i)]);
  if (total !== GENUINE_TOTAL) return loc_0167(m);
}
