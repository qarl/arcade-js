// SPDX-License-Identifier: GPL-3.0-only
/** paintReadoutsThenSampleWitnessOrDerail — one arm of the copyright/attract sequence machine that
 * repaints the labelled numeric readouts and refreshes a tile-image tamper witness, guarding the
 * screen twice on the way through.
 *
 * First the copyright line's colours are checked, which derails the machine if any cell is wrong.
 * Then one caption cell is read: unless it still holds its expected glyph the arm hands off to the
 * mother-ship warp/flash handler through its misaligned anti-tamper entry — the "wrong-glyph"
 * derail. Neither derail has a faithful transcription as a routine — each lands in bytes that
 * destroy the stack frame — so both raise where the transfer would begin; a genuine image never
 * takes either (the copyright line is painted, in its two flashing colours, before this arm runs).
 * On a clean image it queues one caption command, repaints the five labelled numeric
 * readouts, copies one cell's glyph and colour aside as the tamper pair read back later, and steps
 * the sequence's inner index on.
 *
 * LIVE-OUT: memory only. Reached as a table-dispatched tail (nothing static calls it) whose two
 * transfers — the wrong-glyph derail and the sequence step — both leave through the successor the
 * dispatcher parked, and that successor reloads every register it uses before reading one, so no
 * register is live out.
 * ROM 0x176A-0x178B. Grounding: [seen] (names.js ROUTINES 0x176A). */

import {
  TAMPER_GLYPH_SOURCE_CELL,
  TAMPER_SAMPLE_GLYPH_CELL,
  TAMPER_SAMPLE_COLOUR_CELL,
  TAMPER_GLYPH_READBACK,
  TAMPER_COLOUR_READBACK,
} from "./names.js";
import { checkTheCopyrightLineColoursOrDerail } from "./checkTheCopyrightLineColoursOrDerail.js";
import { stepMotherShipWarpFlashFrame } from "./stepMotherShipWarpFlashFrame.js";
import { postCommand } from "./postCommand.js";
import { paintFiveLabelledNumericReadouts } from "./paintFiveLabelledNumericReadouts.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";

const EXPECTED_GLYPH = 0x7c;
const CAPTION_COMMAND = 0x01;
const CAPTION_ARGUMENT = 0x13;

export function paintReadoutsThenSampleWitnessOrDerail(m) {
  const { mem8 } = m;

  checkTheCopyrightLineColoursOrDerail(m);

  if (mem8[TAMPER_GLYPH_SOURCE_CELL] !== EXPECTED_GLYPH) {
    // wrong-glyph derail: the mother-ship warp/flash handler's misaligned entry, which raises.
    stepMotherShipWarpFlashFrame();
    return;
  }

  postCommand(m, CAPTION_COMMAND, CAPTION_ARGUMENT);
  paintFiveLabelledNumericReadouts(m);

  mem8[TAMPER_GLYPH_READBACK] = mem8[TAMPER_SAMPLE_GLYPH_CELL];
  mem8[TAMPER_COLOUR_READBACK] = mem8[TAMPER_SAMPLE_COLOUR_CELL];

  advanceSequenceSubStep(m);
}
