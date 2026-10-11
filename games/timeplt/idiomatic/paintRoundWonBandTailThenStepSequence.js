// SPDX-License-Identifier: GPL-3.0-only
/** paintRoundWonBandTailThenStepSequence — finish the round-won band's tile row, then colour the band animation's cells from a base colour. Starting at the cursor the caller
 * leaves in HL it lays the caller's A over one cell, then a run of the caller's C, then a short
 * fixed tail; next it reads the base colour and fills two thirteen-cell colour-RAM runs and six scattered colour
 * cells, every value the base plus a fixed offset. Last it seeds the saved pen from the era and
 * steps the sequence sub-step. LIVE-OUT: the cells written; A, C, HL and DE are left as scratch.
 *
 * ROM 0x4A42-0x4A9C (frozen lift translated/loc_4a42.js). Grounding: [seen] (names.js ROUTINES 0x4a42).
 *
 * ROLE IN THE MACHINE. This is the second half of the round-won band animation. names.js and
 * mechanisms.md record that on a genuine image the body runs only as the fall-through of
 * armRoundWonBandAnimationThenStepSequence, which seats the lead byte (A), the body byte (C) and
 * the cursor (HL) before arriving here; its own entry point is reached by no transfer that can fire -- the one `jr c,0x4a42`, at 0x4A0C
 * inside derail bytes, follows an `and l` that clears carry.
 *
 * HARDWARE BACKGROUND. The character plane is two parallel RAMs: tile codes in video RAM and a
 * colour attribute per cell in colour RAM, 0x400 bytes lower. Clearing bit 2 of the high address
 * byte (the ROM's `res 2,h`) folds a video-RAM address onto the same cell's colour byte — so each
 * colour address below is the colour-plane twin of a character-plane cell (names.js). A tilemap
 * row is 32 bytes; the board is ROT90, so one row back in memory (ROW) is one cell along a
 * displayed line.
 *
 * `head` is the lead byte, `body` the run byte and `cursor` the cursor (one cell before where
 * writing starts).
 * Kept as the ROUTINES override of 0x4A42: no idiomatic module calls
 * it, because armRoundWonBandAnimationThenStepSequence runs this body inline.
 */

import { u8, u16 } from "../../../core/int.js";
import { fillCellRun } from "./fillCellRun.js";
import { setSavedPenFromEra } from "./setSavedPenFromEra.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { PEN_COLOUR, CAPTION_COLOUR_LOWER_RUN_BOTTOM, CAPTION_COLOUR_UPPER_RUN_BOTTOM, CAPTION_BAND_COLOUR_CELL0, CAPTION_BAND_COLOUR_CELL1, CAPTION_BAND_COLOUR_CELL2 } from "./names.js";

// The run shape the ROM writes after the lead byte: `ld b,0x0d` cells of the caller's C, then
// `ld a,0x0e / ld b,0x04` — four cells of the fixed tail byte 0x0E. ROW is one tilemap row (32).
const BODY_RUN = 13;
const TAIL_RUN = 4;
const TAIL_FILL = 0x0e;
const ROW = 0x20;

// The colour addresses used below (CAPTION_COLOUR_*_RUN_BOTTOM and CAPTION_BAND_COLOUR_CELL0-2 in
// names.js) are already folded through `res 2,h` into colour RAM; each cell's second value sits one
// row (ROW) back.

export function paintRoundWonBandTailThenStepSequence(m, head = m.regs.a, body = m.regs.c, cursor = m.regs.hl) {
  const { mem8 } = m;

  /* Step 1 — the byte run (ROM 0x4A42-0x4A52). `inc hl / ld (hl),a` puts the lead byte one past
   * the caller's cursor; then `ld (hl),c / inc hl` under `djnz` lays thirteen body bytes, and
   * `ld (hl),a / inc hl` under `djnz` the four 0x0E tail bytes, each at the next address up. */
  let cur = u16(cursor + 1);
  mem8[cur] = head;
  for (let i = 0; i < BODY_RUN; i++) mem8[cur = u16(cur + 1)] = body;
  for (let i = 0; i < TAIL_RUN; i++) mem8[cur = u16(cur + 1)] = TAIL_FILL;

  /* Step 2 — the base colour. `ld a,(0xad0c) / ld c,a`: PEN_COLOUR, the live caption/pen colour
   * attribute of the active player's context, kept in C and added to every colour value below. */
  const base = mem8[PEN_COLOUR];

  /* Step 3 — two thirteen-cell colour runs (the `call 0x1319`s at 0x4A5F and 0x4A6A). fillCellRun
   * lays one byte over thirteen cells, walking one row back per cell: base+0xA0 from the colour
   * twin of 0xA7B1 (CAPTION_COLOUR_LOWER_RUN_BOTTOM, 0xA3B1), then base+0x20 from the colour twin
   * of 0xA5D1 (CAPTION_COLOUR_UPPER_RUN_BOTTOM, 0xA1D1). Each sum wraps at eight bits (`add a,c`). */
  fillCellRun(m, u8(0xa0 + base), CAPTION_COLOUR_LOWER_RUN_BOTTOM);
  fillCellRun(m, u8(0x20 + base), CAPTION_COLOUR_UPPER_RUN_BOTTOM);

  /* Step 4 — six scattered colour cells (ROM 0x4A6D-0x4A96). For each of 0xA610, 0xA612 and 0xA611,
   * folded by `res 2,h` to 0xA210/0xA212/0xA211, the ROM stores one value at the cell and a second
   * one row back — its `add hl,de` uses the DE = 0xFFE0 (minus one row) fillCellRun left behind. The
   * pairs are base+0xA0 / base+0x20, then base+0xE0 / base+0x60, then base+0xA0 / base+0x20, in
   * that order. */
  mem8[CAPTION_BAND_COLOUR_CELL0] = u8(0xa0 + base);
  mem8[u16(CAPTION_BAND_COLOUR_CELL0 - ROW)] = u8(0x20 + base);
  mem8[CAPTION_BAND_COLOUR_CELL2] = u8(0xe0 + base);
  mem8[u16(CAPTION_BAND_COLOUR_CELL2 - ROW)] = u8(0x60 + base);
  mem8[CAPTION_BAND_COLOUR_CELL1] = u8(0xa0 + base);
  mem8[u16(CAPTION_BAND_COLOUR_CELL1 - ROW)] = u8(0x20 + base);

  /* Step 5 — hand-off. `call 0x339c`: setSavedPenFromEra seeds the pen glyph and colour the active
   * player's SAVED context will hand back, from a ROM record the era selects (the live pen is left
   * alone). Then `jp 0x0f1a`: advanceSequenceSubStep steps the inner sequence index on by one, as a
   * tail jump, so the sequence machine moves on to its following step. */
  setSavedPenFromEra(m);
  advanceSequenceSubStep(m);
}
