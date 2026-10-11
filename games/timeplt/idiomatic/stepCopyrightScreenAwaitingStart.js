// SPDX-License-Identifier: GPL-3.0-only
/** stepCopyrightScreenAwaitingStart — one title/attract sequence arm (table-dispatched): re-stamp the copyright strip,
 * re-request the flashing copyright line, sample one cell into a two-byte record; then hand off to
 * the one-player start when 1-player start is held, return when the credit count is one, else
 * queue one command pair and step the sequence sub-step. LIVE-OUT: memory only. */
//
// ROM 0x07E6-0x0808; lift: translated/loc_07e6.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. The sequence machine's phase 2 is "a credit on the board, waiting for start"
// (mechanisms.md). This is its step 3, the ONE-credit wait: this arm runs every frame, with the
// copyright line on screen, until a start is pressed or a second credit arrives. Step 2
// (postPushStartScreenCaptions) sends the machine here with exactly one credit; with two or more it goes
// straight to step 4, the two-credit wait, which is where this arm also sends it when a second credit
// arrives. A two-player game can only be started from step 4.
//
// LIVE-OUT: memory only -- the display list and caption requests, the sampled witness pair at
// TAMPER_GLYPH_STRIP, and on a start whatever startOnePlayerGame sets up.

import { stampCopyrightStrip } from "./stampCopyrightStrip.js";
import { flashCopyrightLine } from "./flashCopyrightLine.js";
import { sampleCellGlyphAndColour } from "./sampleCellGlyphAndColour.js";
import { startOnePlayerGame } from "./startOnePlayerGame.js";
import { postCommand } from "./postCommand.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { CREDIT_COUNT, IN0_MIRROR, TAMPER_GLYPH_STRIP, COPYRIGHT_GLYPH_SAMPLE_CELL } from "./names.js";

// IN0_MIRROR bit 3 is the 1-player start button (`bit 3,a` at 0x07F8).
const ONE_PLAYER_START = 0x08;
// Command pair (1, 25) -- `ld de,0x0119` at 0x0802 -- is caption 25, the same caption step 2 posts
// when it sends the machine to step 4 with two or more credits.
const COMMAND = 1;
const ARGUMENT = 25;

export function stepCopyrightScreenAwaitingStart(m) {
  const { mem8 } = m;
  // Keep the screen alive: re-stamp the copyright strip into the display list (0x0B06) and request
  // the copyright line in this frame's colour (0x0B39), so it flashes.
  stampCopyrightStrip(m);
  flashCopyrightLine(m);
  // Anti-tamper witness: copy the glyph and colour at copyright cell 0xA61C
  // (COPYRIGHT_GLYPH_SAMPLE_CELL) into TAMPER_GLYPH_STRIP / TAMPER_COLOUR_STRIP (0xABFE/0xABFF) [seen].
  // Nothing here checks it; the player's death animation (advancePlayerAnimationStrip) later requires
  // glyph 0xA5 with colour 0x05 or 0x10 and derails otherwise, so a patched caption bites in play.
  sampleCellGlyphAndColour(m, COPYRIGHT_GLYPH_SAMPLE_CELL, TAMPER_GLYPH_STRIP);
  // 1-player start held (IN0_MIRROR, 0xA9AE [seen], this frame's complemented copy of the IN0 port): start a
  // one-player game (`jp nz,0x3215`), which takes the credit.
  if (mem8[IN0_MIRROR] & ONE_PLAYER_START) return startOnePlayerGame(m);
  // Still exactly one credit (CREDIT_COUNT, 0xA986, packed decimal; `dec a / ret z`): keep waiting.
  if (mem8[CREDIT_COUNT] === 1) return;
  // More credits have arrived: post caption 25 and step on to step 4, the two-credit wait
  // (`jp 0x0f1a`, advanceSequenceSubStep).
  postCommand(m, COMMAND, ARGUMENT);
  return advanceSequenceSubStep(m);
}
