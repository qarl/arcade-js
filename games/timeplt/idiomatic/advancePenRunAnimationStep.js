// SPDX-License-Identifier: GPL-3.0-only
/**
 * advancePenRunAnimationStep — one step of the sequence machine that runs the "pen" along its route:
 * advance the interpolated pen run by one run, and only when that run has finished (it reseated to a
 * zero row integer) take an anti-tamper checksum and step the sequence on.
 *
 * ROM 0x1734-0x1747. Grounding: [seen] (names.js ROUTINES 0x1734).
 *
 * ROLE IN THE MACHINE. Its one caller is dispatchSequencePhase1SubStepArm, the inner arm table of one
 * outer sequence mode. The sequence machine (SEQUENCE_PHASE / SEQUENCE_SUBSTEP, both [seen]) calls one
 * arm per frame and only moves to the next arm when the current one steps SEQUENCE_SUBSTEP. This arm
 * therefore repeats frame after frame, each frame stamping one more run of pen cells (attract step 0 has set the
 * pen to the blank glyph 0xF1, so here the runs erase the route leg by leg -- mechanisms.md "Step 1"), until the drawer
 * reports that the run it just finished reseated to row zero; that frame the arm hands on.
 *
 * WHY THE CHECKSUM. On its way out the arm sums (negatively) the 34 bytes of the routine at ROM 0x1748
 * (holdCopyrightThenEraseTheCoinInvitation_ADDR, read here as DATA, not called) and parks the result
 * in 0xA817. On a genuine image the sum is 0x00 (checked against the ROM image); an edited routine
 * leaves a non-zero value. names.js BANK_LAUNCH_COOLDOWN [seen] records that 0xA817 is MULTIPLEXED:
 * in the attract sequence it carries this checksum verdict, which the credit line later reads; in play it is
 * the bank-launch cooldown. The name imported here is the in-play name of the same cell.
 *
 * LIVE-OUT: memory only (0xA817 and, via the tail, SEQUENCE_SUBSTEP).
 */

import { drawInterpolatedPenRun } from "./drawInterpolatedPenRun.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { BANK_LAUNCH_COOLDOWN, holdCopyrightThenEraseTheCoinInvitation_ADDR } from "./names.js";

/** Length of the guarded routine at 0x1748: the ROM's `ld b,0x22` at 0x173B ("its exact length"). */
const GUARDED_LEN = 0x22;

export function advancePenRunAnimationStep(m) {
  const { mem8 } = m;

  // Step 1 — draw. drawInterpolatedPenRun (ROM 0x0201) stamps one run of pen-glyph cells toward the
  // current target and loads the next run. The ROM follows it with `ret nz` at 0x1737: unless the
  // run reseated to a zero row integer, this frame's work is done and the arm will be called again.
  const reseatedAtRowZero = drawInterpolatedPenRun(m);
  if (!reseatedAtRowZero) return;

  // Step 2 — the anti-tamper checksum (ROM 0x1738-0x1742). The ROM zeroes A, then `sub (hl)` over each
  // of the 34 bytes, i.e. A = 0 - sum(bytes) modulo 256. That is 0x00 for the genuine routine at
  // 0x1748; the verdict is stored into 0xA817 whatever it is — nothing here branches on it.
  let sum = 0;
  for (let i = 0; i < GUARDED_LEN; i++) sum = (sum - mem8[holdCopyrightThenEraseTheCoinInvitation_ADDR + i]) & 0xff;
  mem8[BANK_LAUNCH_COOLDOWN] = sum;

  // Step 3 — hand on. The ROM tail-jumps to 0x0F1A (advanceSequenceSubStep), so the next frame the
  // sequence machine dispatches the following arm.
  return advanceSequenceSubStep(m);
}
