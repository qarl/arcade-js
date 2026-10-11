// SPDX-License-Identifier: GPL-3.0-only
/** postPushStartScreenCaptions — one arm of the two-level sequence machine: stamps the copyright strip,
 * flashes the copyright line, then posts a fixed run of caption codes to the command ring as
 * (1, code) pairs, three of them chosen by two work cells, then bumps the sequence counter twice on the
 * high branch and once on the low.
 *
 * ROM 0x1830-0x1869 (lift: translated/loc_1830.js). Grounding: [seen] (names.js ROUTINES 0x1830).
 *
 * ROLE IN THE MACHINE. Step 2 of sequence phase 2, "a credit on the board, waiting for start"
 * (inner index 2 of dispatchSequencePhase2SubStepArm; mechanisms.md "Step 2"). It lays out the
 * information text of the screen in one burst -- the captions are only REQUESTS on the command ring; the ring's
 * drain draws them later. Which bonus-life pair appears follows the operator's bonus-life
 * setting, and which credit line appears decides where the sequence goes next:
 *   - two or more credits: caption 25 and two steps, straight to step 4;
 *   - otherwise: caption 23 and one step, to step 3, the one-credit wait
 *     (stepCopyrightScreenAwaitingStart).
 * LIVE-OUT: memory. */

import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { stampCopyrightStrip } from "./stampCopyrightStrip.js";
import { flashCopyrightLine } from "./flashCopyrightLine.js";
import { postCommand } from "./postCommand.js";
import { BONUS_LIFE_SETTING, CREDIT_COUNT } from "./names.js";

// Command 1 on the ring is a caption request; its argument is the caption record index.
const CAPTION_COMMAND = 0x01;
// Captions 1, 20 and 21, posted first on every pass.
const LEADING_CAPTIONS = [0x01, 0x14, 0x15];
// The two bonus-life pairs (mechanisms.md): "1ST BONUS 10000 PTS." / "AND EVERY 50000 PTS."
// and the 20000/60000 pair; each pair is two consecutive captions.
const BONUS_CAPTIONS_LOW = 0x0f; // this pair when the bonus-life setting is 0
const BONUS_CAPTIONS_HIGH = 0x11; // this pair otherwise
// Captions 22 and 0, after the bonus pair.
const TRAILING_CAPTIONS = [0x16, 0x00];
// The credit count at which the two-credit line is shown instead.
const TWO_CREDITS = 2;
const TWO_CREDIT_CAPTION = 0x19;
const ONE_CREDIT_CAPTION = 0x17;

export function postPushStartScreenCaptions(m) {
  const { mem8 } = m;
  // Every caption goes out as a (1, code) request on the command ring.
  const post = (code) => postCommand(m, CAPTION_COMMAND, code);

  /* Step 1 -- keep the copyright showing and flashing, as every step of this screen does
   * (stampCopyrightStrip re-stamps the fixed pieces; flashCopyrightLine alternates the colour
   * on the frame counter's low bit). */
  stampCopyrightStrip(m);
  flashCopyrightLine(m);

  /* Step 2 -- the fixed information text, with the bonus-life pair picked by BONUS_LIFE_SETTING
   * 0xA9C3 (the setting that also selects the bonus-life mark list, names.js): 15/16
   * when it is zero, 17/18 otherwise. */
  for (const code of LEADING_CAPTIONS) post(code);
  const bonus = mem8[BONUS_LIFE_SETTING] === 0 ? BONUS_CAPTIONS_LOW : BONUS_CAPTIONS_HIGH;
  post(bonus);
  post(bonus + 1);
  for (const code of TRAILING_CAPTIONS) post(code);

  /* Step 3 -- the credit line and the next step, by CREDIT_COUNT 0xA986 (packed BCD, so ">= 2"
   * compares correctly as a plain byte). Two or more credits skip the one-credit wait entirely. */
  if (mem8[CREDIT_COUNT] >= TWO_CREDITS) {
    post(TWO_CREDIT_CAPTION);
    advanceSequenceSubStep(m);
    return advanceSequenceSubStep(m);
  }
  post(ONE_CREDIT_CAPTION);
  return advanceSequenceSubStep(m);
}
