// SPDX-License-Identifier: GPL-3.0-only
/** guardBlockOrBlankDisplay — let the sequence move on only if a block of the program image still adds up.
 * A running eight-bit total is seeded from one program byte and fifty-one more added. When it is
 * the one expected, the inner sequence index is stepped. Otherwise the display is switched off
 * through the output latch — the written value taken from a program byte too — and one character
 * cell is copied into a pair of work cells (glyph then the colour beside it); that arm leaves the
 * sequence index put, so nothing after it runs. The Z80 also left the total, its spent counter,
 * two cursors and the compare's flags standing in registers; nothing that runs after either arm
 * reads any of them, so they are not handed back.
 *
 * ROM 0x17B9-0x17E1 (frozen lift translated/loc_17b9.js). Grounding: [seen] (names.js ROUTINES 0x17b9).
 *
 * Role in the machine: an anti-tamper step of the sequence machine. It is the eighth entry of the
 * word table at 0x1659 that dispatchSequencePhase1SubStepArm dispatches, so a patched image holds
 * the attract sequence here with a dark screen until a credit or a free-play start moves the machine on. The 51 bytes it adds run
 * from stampCopyrightStrip's entry (0x0B06) through the last byte of hideCaptionSprites (0x0B38), so the guard covers both routines; names.js records that the total over the
 * real image is exactly the value compared. The witness pair it writes on failure (TAMPER_WITNESS)
 * is the one seedSceneryEntriesThenRunScenery later checks.
 *
 * LIVE-OUT: memory. */

import { u8 } from "../../../core/int.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { TAMPER_WITNESS, stampCopyrightStrip_ADDR, COPYRIGHT_STRIP_CHECK_SEED, DISPLAY_OFF_VALUE, VIDEO_ENABLE_LATCH, TAMPER_WITNESS_SAMPLE_CELL } from "./names.js";

// 0x33 bytes added; the total must come to 0xEF (the ROM's `cp 0xef`).
const GUARDED_BYTES = 51;
const EXPECTED_TOTAL = 239;
// Clearing bit 10 of a character-plane address moves from the glyph cell to its colour cell (the
// ROM's `res 2,h`: 0xA65C becomes 0xA25C).
const CHARACTER_PLANE_BIT = 1 << 10;

export function guardBlockOrBlankDisplay(m) {
  const { mem8 } = m;
  // The fold: seed from COPYRIGHT_STRIP_CHECK_SEED (ROM 0x4A40), then add the guarded bytes with
  // eight-bit wrap, as `add a,(hl)` does.
  let total = mem8[COPYRIGHT_STRIP_CHECK_SEED];
  for (let i = 0; i < GUARDED_BYTES; i++) total = u8(total + mem8[stampCopyrightStrip_ADDR + i]);

  // Genuine image: step the sequence on (the ROM's tail jump to 0x0F1A).
  if (total === EXPECTED_TOTAL) {
    advanceSequenceSubStep(m);
    return;
  }

  // Tampered: write DISPLAY_OFF_VALUE (a ROM byte, 0x00) to the picture-enable latch, blanking the
  // screen, then copy the sample cell's glyph and its colour into the two witness cells.
  mem8[VIDEO_ENABLE_LATCH] = mem8[DISPLAY_OFF_VALUE];
  const colourCell = TAMPER_WITNESS_SAMPLE_CELL & ~CHARACTER_PLANE_BIT;
  mem8[TAMPER_WITNESS] = mem8[TAMPER_WITNESS_SAMPLE_CELL];
  mem8[TAMPER_WITNESS + 1] = mem8[colourCell];
}
