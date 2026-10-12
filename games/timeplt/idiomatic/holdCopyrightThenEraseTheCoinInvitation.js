// SPDX-License-Identifier: GPL-3.0-only
/** holdCopyrightThenEraseTheCoinInvitation — hold one sequence step for as long as its delay cell counts, restamping the
 * copyright caption and flashing its line on every frame of the wait, then leave the step.
 *
 * ROM 0x1748-0x1769 (lift: translated/loc_1748.js). Grounding: [seen] (names.js ROUTINES 0x1748).
 *
 * ROLE IN THE MACHINE. Step 4 of sequence phase 1, the attract cycle
 * (dispatchSequencePhase1SubStepArm, inner index 4; mechanisms.md "Step 4"). The screen invites a coin; this step holds it, then
 * erases the invitation -- caption records 3 and 4, PLEASE DEPOSIT COIN and AND TRY THIS GAME --
 * while the copyright line it has been restamping stays.
 *
 * The delay comes down by one per frame and nothing else happens until it reaches zero, so the
 * step lasts as many frames as the cell held on arrival — and a cell holding zero on arrival
 * wraps to 255 and waits the long way round rather than leaving at once (after power-on that is
 * what happens: a 256-frame hold, mechanisms.md). On the frame it expires, one cell of the caption
 * is sampled from both planes and the pair kept aside, two commands go out to the ring, and the
 * sequence moves on to its next step.
 * LIVE-OUT: memory only. */

import { u8 } from "../../../core/int.js";
import { SEQUENCE_DELAY, TAMPER_GLYPH_KONAMI, COPYRIGHT_SAMPLE_COLOUR_CELL, COPYRIGHT_SAMPLE_GLYPH_CELL } from "./names.js";
import { stampCopyrightStrip } from "./stampCopyrightStrip.js";
import { flashCopyrightLine } from "./flashCopyrightLine.js";
import { postCommand } from "./postCommand.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";

// Command 3 is the ring's erase-a-caption request (eraseTextRunByIndex); arguments 3 and 4 are
// the two coin-invitation caption records (`ld de,0x0303` / `inc e` at 0x1760-0x1764).
const COMMAND = 3;
const FIRST_ARGUMENT = 3;

export function holdCopyrightThenEraseTheCoinInvitation(m) {
  const { mem8 } = m;

  /* Step 1 -- keep the copyright on screen every frame of the wait (call 0x0B06, call 0x0B39).
   * stampCopyrightStrip re-stamps the caption's fixed pieces (idempotent), and flashCopyrightLine
   * asks for the line in one of two colours by the frame counter's low bit, so it flashes. */
  stampCopyrightStrip(m);
  flashCopyrightLine(m);

  /* Step 2 -- the hold (0x174E-0x1752). SEQUENCE_DELAY 0xA9EB [seen] counts down once per frame
   * and the step returns while it is still running. */
  const left = u8(mem8[SEQUENCE_DELAY] - 1);
  mem8[SEQUENCE_DELAY] = left;
  if (left !== 0) return;

  /* Step 3 -- seat the copyright TAMPER WITNESS (0x1753-0x175F). The glyph at 0xA63C
   * (COPYRIGHT_SAMPLE_GLYPH_CELL) is the fifth cell of the "(c) KONAMI 1982" caption -- the N,
   * glyph 0x3B -- and 0xA23C (COPYRIGHT_SAMPLE_COLOUR_CELL) is the same cell in the colour plane
   * (the ROM's `res 2,h` turns one address into the other). Both go into TAMPER_GLYPH_KONAMI
   * 0xACC7 [seen] and the cell after it. Later, setSceneryAttributesThenRunEraScenery (0x30D1), on its
   * era-4-and-up path, reads that pair back and jumps off its genuine path (through 0x315B)
   * unless the glyph is still 0x3B and the colour 0x05 or 0x10 -- so an edited copyright line is
   * caught here without failing cleanly (names.js ROUTINES 0x1748). */
  mem8[TAMPER_GLYPH_KONAMI] = mem8[COPYRIGHT_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_GLYPH_KONAMI + 1] = mem8[COPYRIGHT_SAMPLE_COLOUR_CELL];

  /* Step 4 -- erase the coin invitation and move on (0x1760-0x1766). Two (3, n) requests go on
   * the command ring for caption records 3 and 4; the ring drains them later, outside this
   * routine. The ROM then tail-jumps to 0x0F1A to step the sequence to its next sub-step. */
  postCommand(m, COMMAND, FIRST_ARGUMENT);
  postCommand(m, COMMAND, FIRST_ARGUMENT + 1);
  advanceSequenceSubStep(m);
}
