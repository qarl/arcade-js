// SPDX-License-Identifier: GPL-3.0-only
/** dispatchSequencePhase2SubStepArm — inner level of the two-level sequence machine: the sub-step
 * index picks one arm from a fixed inline word table, that arm runs, then this mode's no-op tail.
 * Each case is the slot's literal target, called directly. The index is RAW; the entry doubling wraps
 * at 8 bits, so index and index+128 pick the same slot (low 7 bits key the switch). Only the first
 * five slots are transcribed arms; the rest are non-routine bytes and fault. LIVE-OUT: the arm's.
 * ROM 0x17FE-0x1805. Grounding: [seen] (names.js ROUTINES 0x17FE). */

import { NotImplemented } from "../../../boards/timeplt/io.js";
import { SEQUENCE_SUBSTEP } from "./names.js";
import { parkSpritesAndArmLineWipeThenAdvanceSequence } from "./parkSpritesAndArmLineWipeThenAdvanceSequence.js";
import { blankOneLineThenGuardBlockOrDerailSequence } from "./blankOneLineThenGuardBlockOrDerailSequence.js";
import { postAttractInfoCaptions } from "./postAttractInfoCaptions.js";
import { stepCopyrightScreenAwaitingStart } from "./stepCopyrightScreenAwaitingStart.js";
import { stepTwoCreditCopyrightScreenAwaitingStart } from "./stepTwoCreditCopyrightScreenAwaitingStart.js";
import { noOpSequencePhase2Tail } from "./noOpSequencePhase2Tail.js";

// The doubling that reaches a two-byte entry wraps at eight bits, so only the low seven bits of the
// index can pick a slot: index and index+128 land on the same word.
const ENTRY_MASK = 0x7f;

export function dispatchSequencePhase2SubStepArm(m) {
  const entry = m.mem8[SEQUENCE_SUBSTEP] & ENTRY_MASK;
  switch (entry) {
    // Slot 0 parks the sprites and arms the line wipe; slot 1 blanks one line and, on the turn that
    // finishes, runs the tamper check; slot 2 posts the attract info captions; slots 3 and 4 are the
    // copyright/insert-coin await-start steps for one credit and for two. None reads a register the
    // dispatch would have left standing — each opens on a cell read or a fixed-argument call — so the
    // arm is entered directly, with no table word carried in on a register pair. Each arm returns, and
    // then the shared tail below runs.
    case 0: parkSpritesAndArmLineWipeThenAdvanceSequence(m); break;
    case 1: blankOneLineThenGuardBlockOrDerailSequence(m); break;
    case 2: postAttractInfoCaptions(m); break;
    case 3: stepCopyrightScreenAwaitingStart(m); break;
    case 4: stepTwoCreditCopyrightScreenAwaitingStart(m); break;
    // The remaining slots address bytes this port has not transcribed as routines; the inline
    // dispatch would jump into them and fault before ever reaching the tail, so surface the same
    // fault here instead.
    default:
      throw new NotImplemented(`dispatchSequencePhase2SubStepArm: phase-2 sub-step arm ${entry} is not a transcribed routine`);
  }
  return noOpSequencePhase2Tail(m);
}
