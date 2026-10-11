// SPDX-License-Identifier: GPL-3.0-only
/** fileScoreAfterGameOverHoldElsePassTurn — hold on the sequence delay, then try to file the finished score.
 *
 * ROM 0x330B-0x3347 (lift: translated/loc_330b.js). Grounding: [seen] (names.js ROUTINES 0x330B).
 *
 * ROLE IN THE MACHINE. Sub-step 8 of the play phase of the two-level sequence machine (entry 8 of
 * the 0x0F29 table, dispatched by dispatchSequenceSubStepArm). The step before it,
 * postGameOverBanner, put PLAYER n and GAME OVER on screen and armed SEQUENCE_DELAY with 180 frames
 * (mechanisms.md, "Filing (step 8)"), so the first thing this step does is hold that banner.
 *
 * While the delay is still counting it just ticks. When it expires and the score beats no standing
 * record, two commands are queued, the sub-step is reseated from a program byte and the turn passes
 * on (or the sequence steps). When the score was filed, a sound is requested, the pen is set to the
 * blanking glyph and armed at its route start, a fixed 256-byte program run is folded into an
 * eight-bit total -- any total but the genuine one advances the outer phase -- and the sub-step
 * steps on, to sub-step 9, the start of initials entry.
 * LIVE-OUT: memory. */

import { u8, u16 } from "../../../core/int.js";
import { fileScoreIntoHighScoreTable } from "./fileScoreIntoHighScoreTable.js";
import { postCommand } from "./postCommand.js";
import { passTurnToOtherPlayerIfLivesElseStepSequence } from "./passTurnToOtherPlayerIfLivesElseStepSequence.js";
import { requestHighScoreFiledSound } from "./requestHighScoreFiledSound.js";
import { armThePenRouteThenColdStartOnATamperedImage } from "./armThePenRouteThenColdStartOnATamperedImage.js";
import { advanceSequencePhase } from "./advanceSequencePhase.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import {
  SEQUENCE_DELAY, SEQUENCE_SUBSTEP, PEN_COLOUR, PEN_GLYPH, SKIP_INITIALS_SUBSTEP_SEED, HIGH_SCORE_FILED_CHECKSUM_BASE,
} from "./names.js";


// Command 3 on the ring is eraseTextRunByIndex (names.js); its arguments are caption indices:
// 9 is PLAYER, 11 is GAME OVER (`ld de,0x0309` / `ld e,0x0b` at 0x3316-0x331C).
const UNFILED_COMMAND = 3;
const UNFILED_ARGUMENTS = [0x09, 0x0b];
// The blank glyph the pen erases with (`ld a,0xf1` at 0x332E; names.js PEN_GLYPH).
const BLANKING_GLYPH = 0xf1;
// `ld b,0x00` then djnz: 256 bytes, not zero (0x3336).
const CHECKED_BYTES = 0x100;
// The total a genuine image gives (`sub 0x19` at 0x3340).
const GENUINE_TOTAL = 0x19;

export function fileScoreAfterGameOverHoldElsePassTurn(m) {
  const { mem8 } = m;

  /* Step 1 -- the banner hold (0x330B-0x3310). SEQUENCE_DELAY 0xA9EB [seen] is the sequence
   * machine's shared one-shot delay; this step counts it down once per frame and returns while it
   * is still running (`dec (hl)` / `ret nz`), so GAME OVER stays up for the span the banner armed. */
  mem8[SEQUENCE_DELAY] = mem8[SEQUENCE_DELAY] - 1;
  if (mem8[SEQUENCE_DELAY] !== 0) return;

  /* Step 2 -- try to file the score (call 0x4CC3). fileScoreIntoHighScoreTable walks the
   * five-record board top-down and slides the new score in where it belongs; it answers "dropped"
   * (the ROM's carry set) when the score beat none of the standing records. */
  const dropped = fileScoreIntoHighScoreTable(m);

  /* Step 3 -- no rank (0x3316-0x3323, then jp 0x12E7). Erase the PLAYER and GAME OVER captions,
   * then reseat SEQUENCE_SUBSTEP from SKIP_INITIALS_SUBSTEP_SEED -- a program byte at 0x0843 that
   * reads 0x0B -- so the sequence jumps past initials setup (9) and entry (10). The turn then goes
   * to passTurnToOtherPlayerIfLivesElseStepSequence, which hands play to the other player when
   * that player still has lives, and otherwise steps the sequence. */
  if (dropped) {
    for (const argument of UNFILED_ARGUMENTS) postCommand(m, UNFILED_COMMAND, argument);
    mem8[SEQUENCE_SUBSTEP] = mem8[SKIP_INITIALS_SUBSTEP_SEED];
    return passTurnToOtherPlayerIfLivesElseStepSequence(m);
  }

  /* Step 4 -- the score was filed (0x3326-0x3335). Ask for the filed-score sound, then set the
   * pen to colour 0 and glyph 0xF1 (the blank) and put it back at the start of its route
   * (armThePenRouteThenColdStartOnATamperedImage), so the pen's next trace lays the same blank
   * tiles along the route in colour 0 instead of the era's colour. That callee carries its own image check too (names.js). */
  requestHighScoreFiledSound(m);
  mem8[PEN_COLOUR] = 0;
  mem8[PEN_GLYPH] = BLANKING_GLYPH;
  armThePenRouteThenColdStartOnATamperedImage(m);

  /* Step 5 -- this ROM's anti-tamper idiom (0x3338-0x3347). The 256 program bytes at
   * HIGH_SCORE_FILED_CHECKSUM_BASE 0x01F1 [seen] are summed to eight bits; any total but 0x19
   * calls advanceSequencePhase (0x0F11), which steps the outer phase and zeroes the sub-step
   * instead of failing cleanly. Either way the step ends by advancing the sub-step (jp 0x0F1A):
   * to sub-step 9 on a genuine image, to sub-step 1 of the next phase after a derail. */
  let total = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) total = u8(total + mem8[u16(HIGH_SCORE_FILED_CHECKSUM_BASE + i)]);
  if (total !== GENUINE_TOTAL) advanceSequencePhase(m);
  return advanceSequenceSubStep(m);
}
