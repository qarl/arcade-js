// SPDX-License-Identifier: GPL-3.0-only
/** stepSequenceUnderChecksum — step the sequence's inner sub-step on, folding a block of the
 * program image on the way; a total that does not match also advances the outer phase first, which
 * derails the sequence rather than halting it.
 *
 * ROLE. The game's top level is a sequence machine: an outer phase and an inner sub-step, each
 * sub-step a routine picked from a word table. This routine is one such step -- the eleventh entry
 * of the word table at 0x1659 that dispatchSequencePhase1SubStepArm dispatches; it has no static
 * call site anywhere in the image. Besides stepping on, it is an anti-tamper check: it adds up a
 * block of the program image and compares the total with a byte stored elsewhere in the image. The
 * block (256 bytes from 0x0BCC), the value the running total starts from (0x89) and where the
 * expected total is read from (0x1A50) are ALL fixed, so on an unaltered image the comparison has
 * one answer and only one arm can run -- under MAME the mismatch call at 0x4B2A is never taken.
 * The mismatch arm neither stops nor reports: it advances the sequence PHASE (a different cell
 * from the sub-step), which restarts the sub-step at zero, and then the sub-step is stepped on as
 * on the passing arm, so a patched image quietly derails the sequence rather than halting.
 *
 * ROM 0x4B19-0x4B2F (frozen lift translated/loc_4b19.js). Grounding: [seen] (names.js ROUTINES
 * 0x4b19). LIVE-OUT: the sub-step, plus the phase.
 */

import { advanceSequencePhase } from "./advanceSequencePhase.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { u8, u16 } from "../../../core/int.js";
import { SEQUENCE_CHECKSUM_SPAN_BASE, EXPECTED_CHECKSUM_TOTAL } from "./names.js";

// The ROM loads BC = 0x0089: B = 0 makes its `djnz` loop run 256 times, C = 0x89 seeds the total.
const BLOCK_BYTES = 256;
const STARTING_TOTAL = 137;

export function stepSequenceUnderChecksum(m) {
  const { mem8 } = m;
  // Byte-wide running sum (carries discarded) of the 256 bytes from 0x0BCC, starting at 0x89.
  let total = STARTING_TOTAL;
  for (let i = 0; i < BLOCK_BYTES; i++) total = u8(total + mem8[u16(SEQUENCE_CHECKSUM_SPAN_BASE + i)]);

  // Mismatch (`sub h / call nz,0x0f11`): advance the outer phase -- the derail. A genuine image
  // never takes this.
  if (total !== mem8[EXPECTED_CHECKSUM_TOTAL]) advanceSequencePhase(m);
  // Either way, tail-jump (`jp 0x0f1a`) to step the sub-step on.
  advanceSequenceSubStep(m);
}
