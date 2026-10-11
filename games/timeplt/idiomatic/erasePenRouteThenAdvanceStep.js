// SPDX-License-Identifier: GPL-3.0-only
/** erasePenRouteThenAdvanceStep — attract-sequence arm (phase 1, sub-step 0): fold a fixed 256-byte program run into an
 * eight-bit total and derail into the checksum-failure landing on any total but the genuine one;
 * otherwise set the pen colour and stamp glyph (to blank), arm the pen to its route start, and step
 * the sequence sub-step -- twice when the pen colour already held its set value. LIVE-OUT: memory.
 *
 * ROM 0x074B-0x0773 (frozen lift loc_074b). Grounding: [seen] (names.js ROUTINES 0x074B).
 *
 * Role in the machine: the game's top level is a two-level sequence machine — an outer phase and
 * an inner sub-step (SEQUENCE_SUBSTEP 0xA9AC [seen]) that picks which arm runs this frame. This
 * is the first arm of attract phase 1, reached through dispatchSequencePhase1SubStepArm. The
 * attract screens use a "pen" that draws a fixed route leg by leg, stamping PEN_GLYPH and
 * PEN_COLOUR into each character cell it passes (plotPenCell). Setting the glyph to the blank
 * 0xF1 turns that pen into an eraser: this arm prepares it, and sub-step 1
 * (advancePenRunAnimationStep) then erases the route one leg per frame (mechanisms.md, phase 1).
 *
 * Anti-tamper: like many arms in this ROM, it first sums a block of the program image and refuses
 * to continue on a modified image. The failure path does not report an error — it jumps into
 * loc_08fa [code], a landing whose bytes are really a data table and which, run as code, derails
 * the machine (names.js). On a genuine image the check does nothing.
 */

import { u8, u16 } from "../../../core/int.js";
import { loc_08fa } from "./loc_08fa.js";
import { armThePenRouteThenColdStartOnATamperedImage } from "./armThePenRouteThenColdStartOnATamperedImage.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { PEN_COLOUR, PEN_GLYPH, ATTRACT_CHECKSUM_BLOCK_BASE } from "./names.js";

const CHECKED_BYTES = 0x100; // ld b,0x00 / djnz: 256 iterations
const GENUINE_TOTAL = 0xb8; // sub 0xb8: the total a genuine image gives
const BLANKING_GLYPH = 0xf1; // the blank glyph: a pen stamping it erases
const PEN_COLOUR_VALUE = 5; // ld a,0x05 / ld (0xad0c),a

export function erasePenRouteThenAdvanceStep(m) {
  const { mem8 } = m;

  /* Step 1 — image check (ROM 0x074B-0x0757). Add up the 256 bytes from ATTRACT_CHECKSUM_BLOCK_BASE
   * (0x4AA0), wrapping at eight bits as the Z80's `add a,(hl)` does, and derail (jp nz,0x08fa) on
   * any total but 0xB8. */
  let total = 0;
  for (let i = 0; i < CHECKED_BYTES; i++) total = u8(total + mem8[u16(ATTRACT_CHECKSUM_BLOCK_BASE + i)]);
  if (total !== GENUINE_TOTAL) return loc_08fa(m);

  /* Step 2 — remember whether PEN_COLOUR (0xAD0C) [seen] already held 5 (ROM cp 0x05, whose flags
   * are parked on the stack with push af across the next calls), then set the pen to colour 5
   * and PEN_GLYPH (0xAD0B) [seen] to the blank, so the pen erases what it passes over. */
  const penColourWasSet = mem8[PEN_COLOUR] === PEN_COLOUR_VALUE;
  mem8[PEN_COLOUR] = PEN_COLOUR_VALUE;
  mem8[PEN_GLYPH] = BLANKING_GLYPH;
  /* Step 3 — put the pen back at the start of its route (call 0x01E1). That routine runs its own
   * 256-byte image check too and cold-starts the machine on a tampered image. */
  armThePenRouteThenColdStartOnATamperedImage(m);
  /* Step 4 — advance the sequence sub-step (0x0F1A). When the pen colour already held 5 on
   * arrival the ROM steps twice (call z,0x0f1a then jp 0x0f1a), skipping sub-step 1 entirely
   * (mechanisms.md); otherwise once. */
  if (penColourWasSet) advanceSequenceSubStep(m);
  return advanceSequenceSubStep(m);
}
