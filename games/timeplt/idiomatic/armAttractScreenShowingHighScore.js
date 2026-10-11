// SPDX-License-Identifier: GPL-3.0-only
/** armAttractScreenShowingHighScore — arm a fresh screen once a per-frame countdown lapses. Every call first ticks that
 * countdown; the rest runs only on the call that zeroes it — push four fixed commands onto the ring,
 * seed a marker into two cells, seed six work-RAM cell pairs from the record list that follows this routine (each
 * destination gets the record's glyph, with colour 0x05 beside it), print the six-digit readout, set two sub-state
 * cells, and push a fifth command only when the gate cell is non-zero. LIVE-OUT: memory.
 *
 * ROM 0x15FE-0x163E (frozen lift translated/loc_15fe.js); its patch list follows at 0x163F.
 * Grounding: [seen] in names.js.
 *
 * Role in the machine: sub-step 6 of sequence phase 0 (the power-on wipe phase), the arm that hands the machine on to the attract phase. The countdown it ticks is a screen wipe —
 * blankNextLine (0x01C2) blanks one line of the character plane per call and counts the lines still
 * owed — so the new screen is only drawn once the old one has been wiped clean. The screen it
 * builds shows the high score: captions posted to the command ring, a pair of marker glyphs and the
 * high-score digits. The six patched cells are work-RAM cells (0xA800 and up), not screen cells. */

import { paintHighScoreReadout } from "./paintHighScoreReadout.js";
import { postCommand } from "./postCommand.js";
import { blankNextLine } from "./blankNextLine.js";
import { FREE_PLAY, SEQUENCE_PHASE, SEQUENCE_SUBSTEP, WITNESS_SEED_TABLE, PLAYER1_SCORE_READOUT_ONES_CELL, PLAYER1_SCORE_READOUT_TENS_CELL } from "./names.js";

// The marker glyph (`ld a,0x13` at 0x160E) written to the two marker cells.
const CELL_SEED = 0x13;
// `ld b,0x06` at 0x1619: the patch list holds six three-byte records.
const PATCH_COUNT = 6;
// `ld (hl),0x05` at 0x1623: the byte stored beside each patched value.
const WITNESS_SEED_COLOUR = 0x05;

export function armAttractScreenShowingHighScore(m) {
  const { mem8 } = m;

  // blankNextLine returns whether its line counter reached zero (Z set); the guard bails while
  // it has not, so consume that return instead of reading the flag back.
  if (!blankNextLine(m)) return;

  /* Step 1 — queue the screen's commands (0x1602-0x160E). Each rst 0x38 appends a command byte and
   * its argument to the command ring, which the foreground drain executes later. Command 1 is the
   * caption drawer, so the first three post captions 5, 6 and 7; the fourth is command 6 with
   * argument 1. */
  postCommand(m, 1, 5);
  postCommand(m, 1, 6);
  postCommand(m, 1, 7);
  postCommand(m, 6, 1);

  /* Step 2 — the marker glyph 0x13 into two character cells one row apart
   * (PLAYER1_SCORE_READOUT_TENS_CELL 0xA701, row 24; PLAYER1_SCORE_READOUT_ONES_CELL 0xA6E1, row 23; both column 1). */
  mem8[PLAYER1_SCORE_READOUT_TENS_CELL] = CELL_SEED;
  mem8[PLAYER1_SCORE_READOUT_ONES_CELL] = CELL_SEED;

  /* Step 3 — apply the patch list at WITNESS_SEED_TABLE (0x163F, 0x1619-0x1627).
   * Each record is {destination low, destination high, value}: the value goes to the destination
   * and 0x05 to the byte after it. The ROM walks the list with a djnz loop over B = 6. */
  let cursor = WITNESS_SEED_TABLE;
  for (let i = 0; i < PATCH_COUNT; i++) {
    const dest = mem8[cursor] | (mem8[cursor + 1] << 8);
    mem8[dest] = mem8[cursor + 2];
    mem8[dest + 1] = WITNESS_SEED_COLOUR;
    cursor += 3;
  }

  /* Step 4 — print the high score's six packed-decimal digits (paintHighScoreReadout, 0x0D6B). */
  paintHighScoreReadout(m);

  /* Step 5 — move the sequence machine on (0x162C-0x1635): outer phase SEQUENCE_PHASE (0xA9AB) = 1,
   * inner sub-step SEQUENCE_SUBSTEP (0xA9AC) = 2. */
  mem8[SEQUENCE_PHASE] = 1;
  mem8[SEQUENCE_SUBSTEP] = 2;
  /* Step 6 — only on a free-play cabinet (FREE_PLAY 0xA9C0 non-zero), post caption 0x0D as well
   * (0x1635-0x163E). */
  if (mem8[FREE_PLAY] === 0) return;

  return postCommand(m, 1, 13);
}
