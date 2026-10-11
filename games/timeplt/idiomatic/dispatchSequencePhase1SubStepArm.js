// SPDX-License-Identifier: GPL-3.0-only
/** dispatchSequencePhase1SubStepArm — inner level of the two-level sequence machine for one outer
 * mode: the sub-step index picks one arm from a fixed inline word table, that arm runs, then this
 * mode's shared tail. Each case is the slot's literal target, called directly. The index is RAW; the
 * entry doubling wraps at eight bits, so index and index+128 pick the same slot (low seven bits key
 * the switch). Thirteen slots are transcribed arms; a higher index addresses bytes that carry no
 * routine, so reaching one is a fault and it is raised, not assumed away. No arm reads a register the
 * dispatch would have left standing — each opens on a cell read or a fixed-argument call — so the arm
 * is entered directly, with no table word carried in on a register pair. LIVE-OUT: memory, and the
 * shared tail's. */

/*
 * ROM 0x1651-0x1658 (dispatch) + 0x1659 (the inline word table PHASE1_SUBSTEP_DISPATCH_TABLE),
 * shared tail 0x167B; grounding [seen] (names.js ROUTINES 0x1651).
 *
 * ROLE. The game is driven by a two-level sequence machine: the outer phase SEQUENCE_PHASE (0 boot
 * wipe, 1 attract sequence, 2 credit / push-start, 3 round engine) picks a per-phase dispatcher, and
 * the inner index SEQUENCE_SUBSTEP (0xA9AC, [seen]) picks one "arm" -- one step of that phase -- from
 * the dispatcher's table. This is the phase-1 dispatcher: the attract sequence, which runs the pen
 * route animation, the credit line and the copyright screen, interleaved with the image-tamper
 * checks, then starts the attract demo.
 *
 * MECHANISM IN THE ROM. `ld hl,0x167b / push hl` plants the shared tail's address as the return
 * address, `ld a,(0xa9ac)` loads the index unmasked, and RST 0x30 (the computed-jump helper) jumps to
 * the table word at 0x1659 + 2*index. The arm's closing `ret` therefore lands on the tail,
 * advanceSequenceElseStartFreePlayGame (0x167B): with credits in the machine it steps the outer phase
 * on (leaving attract for the push-start phase); otherwise, only with free play set and a start
 * button held, it starts a game charging no credit. Here the
 * switch calls the arm and then runs the tail explicitly.
 */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { SEQUENCE_SUBSTEP } from "./names.js";
import { advanceSequenceElseStartFreePlayGame } from "./advanceSequenceElseStartFreePlayGame.js";
import { armPenRouteInColour5ThenAdvanceStep } from "./armPenRouteInColour5ThenAdvanceStep.js";
import { advancePenRunAnimationStep } from "./advancePenRunAnimationStep.js";
import { showCreditLine } from "./showCreditLine.js";
import { buildCopyrightScreenThenVerifyImage } from "./buildCopyrightScreenThenVerifyImage.js";
import { holdCopyrightThenEraseTheCoinInvitation } from "./holdCopyrightThenEraseTheCoinInvitation.js";
import { paintReadoutsThenSampleWitnessOrDerail } from "./paintReadoutsThenSampleWitnessOrDerail.js";
import { holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail } from "./holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail.js";
import { guardBlockOrBlankDisplay } from "./guardBlockOrBlankDisplay.js";
import { guardBlockOrDerailSequence } from "./guardBlockOrDerailSequence.js";
import { foldImageBlockIntoSignatureThenAdvanceSequence } from "./foldImageBlockIntoSignatureThenAdvanceSequence.js";
import { stepSequenceUnderChecksum } from "./stepSequenceUnderChecksum.js";
import { trampolineToAdvanceSequenceSubStep } from "./trampolineToAdvanceSequenceSubStep.js";
import { verifyImageSignatureThenStartAttractDemoOrDerail } from "./verifyImageSignatureThenStartAttractDemoOrDerail.js";

// The doubling that reaches a two-byte entry wraps at eight bits, so only the low seven bits of the
// index can pick a slot: index and index+128 land on the same word.
const ENTRY_MASK = 0x7f;

export function dispatchSequencePhase1SubStepArm(m) {
  // Pick the table word: the raw inner index, reduced to the seven bits the eight-bit doubling keeps.
  const entry = m.mem8[SEQUENCE_SUBSTEP] & ENTRY_MASK;
  switch (entry) {
    // The tamper-check / copyright / attract sequence, in order: arm the pen route in colour 5, animate the pen
    // run, show the credit line, build the copyright screen, hold it and erase the coin invitation,
    // paint the readouts and sample the witness, hold and verify the glyph, two guard-block steps, fold
    // the image block into the signature, step under the checksum, a bare trampoline step, and finally
    // verify the signature and start the attract demo. Each arm returns, then the shared tail runs.
    case 0: armPenRouteInColour5ThenAdvanceStep(m); break;
    case 1: advancePenRunAnimationStep(m); break;
    case 2: showCreditLine(m); break;
    case 3: buildCopyrightScreenThenVerifyImage(m); break;
    case 4: holdCopyrightThenEraseTheCoinInvitation(m); break;
    case 5: paintReadoutsThenSampleWitnessOrDerail(m); break;
    case 6: holdCopyrightThenVerifyGlyphAndSeatWitnessOrDerail(m); break;
    case 7: guardBlockOrBlankDisplay(m); break;
    case 8: guardBlockOrDerailSequence(m); break;
    case 9: foldImageBlockIntoSignatureThenAdvanceSequence(m); break;
    case 10: stepSequenceUnderChecksum(m); break;
    case 11: trampolineToAdvanceSequenceSubStep(m); break;
    case 12: verifyImageSignatureThenStartAttractDemoOrDerail(m); break;
    // A higher index addresses bytes this port has not transcribed as routines; the inline dispatch
    // would jump into them and fault before ever reaching the tail, so surface the same fault here.
    default:
      throw new NotImplemented(`dispatchSequencePhase1SubStepArm: phase-1 sub-step arm ${entry} is not a transcribed routine`);
  }
  // The shared tail every arm returns into (0x167B): credits present -> step the outer phase; none
  // -> start a game only when free play is set and a start button is held.
  return advanceSequenceElseStartFreePlayGame(m);
}
