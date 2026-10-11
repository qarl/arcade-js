// SPDX-License-Identifier: GPL-3.0-only
/**
 * blankCaptionThenAdvancePenRunStep — a sequence arm that blanks a fixed caption run and advances the
 * interpolated pen run; once the run has finished (reseated to a zero row integer) it runs two
 * anti-tamper folds and steps the sequence on.
 *
 * ROM 0x5BD7-0x5BFF. Grounding: [seen] (names.js ROUTINES 0x5BD7).
 *
 * ROLE IN THE MACHINE. Entry 2 of the sub-step arm table at 0x0F29, dispatched by
 * dispatchSequenceSubStepArm. Like advancePenRunAnimationStep it is re-entered frame after frame: each
 * frame re-blanks the caption run and draws one more pen run, and only the frame on which the pen run
 * reseats to row zero goes on to the checks and steps SEQUENCE_SUBSTEP [seen].
 *
 * THE TWO FOLDS (both checked against the ROM image; on a genuine image neither changes anything):
 *   1. XOR of the 256 program bytes at 0x0BDD must be 0x1C; any other value advances the outer sequence
 *      phase (advanceSequencePhase, ROM 0x0F11) — the machine is thrown into another mode.
 *   2. SEQUENCE_PHASE [seen] plus the 20 program bytes at 0x1734 (the first bytes of
 *      advancePenRunAnimationStep, read as data) plus 0x77 is written back to SEQUENCE_PHASE. Those bytes sum
 *      to 0x89 and 0x89 + 0x77 wraps to 0, so a genuine image leaves the phase as it was; an altered one
 *      shifts it.
 *
 * LIVE-OUT: memory.
 */

import { blankFourteenCharCells } from "./blankFourteenCharCells.js";
import { drawInterpolatedPenRun } from "./drawInterpolatedPenRun.js";
import { advanceSequencePhase } from "./advanceSequencePhase.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { u8 } from "../../../core/int.js";
import { advancePenRunAnimationStep_ADDR, IMAGE_GUARD_BLOCK_0BDD_BASE, SEQUENCE_PHASE } from "./names.js";

/** Fold 1: 256 bytes (ROM `ld b,a` with A = 0, so `djnz` runs 256 times) from 0x0BDD must XOR to 0x1C. */
const XOR_LEN = 256;
const XOR_TARGET = 0x1c;
/** Fold 2: 20 bytes (ROM `ld b,0x14`) from 0x1734, biased by 0x77 so the genuine total is zero. */
const SUM_LEN = 20;
const SUM_BIAS = 0x77;

export function blankCaptionThenAdvancePenRunStep(m) {
  const { mem8 } = m;
  // Blank the fixed fourteen-cell caption run (ROM call 0x07D2), every frame this arm runs.
  blankFourteenCharCells(m);
  // Draw one interpolated pen run (ROM call 0x0201) and, as the ROM's `ret nz` does, stop here for this
  // frame unless the run just finished.
  const reseatedAtRowZero = drawInterpolatedPenRun(m);
  if (!reseatedAtRowZero) return;

  // Fold 1 (ROM 0x5BDE-0x5BEB): XOR check; a mismatch steps the outer phase (the ROM's `call nz,0x0f11`).
  let fold = 0;
  for (let i = 0; i < XOR_LEN; i++) fold ^= mem8[IMAGE_GUARD_BLOCK_0BDD_BASE + i];
  if (fold !== XOR_TARGET) advanceSequencePhase(m);

  // Fold 2 (ROM 0x5BEC-0x5BFC): the self-cancelling add-checksum folded through SEQUENCE_PHASE.
  let acc = mem8[SEQUENCE_PHASE];
  for (let i = 0; i < SUM_LEN; i++) acc = u8(acc + mem8[advancePenRunAnimationStep_ADDR + i]);
  mem8[SEQUENCE_PHASE] = u8(acc + SUM_BIAS);

  // Hand on to the next arm (ROM tail-jump to 0x0F1A).
  return advanceSequenceSubStep(m);
}
