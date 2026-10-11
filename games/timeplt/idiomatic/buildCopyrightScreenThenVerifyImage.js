// SPDX-License-Identifier: GPL-3.0-only
/**
 * buildCopyrightScreenThenVerifyImage — the sequence arm that lays out the title/attract copyright
 * screen, then checks a block of program bytes before letting the sequence move on.
 *
 * ROM 0x083E-0x086A. Grounding: [seen] (names.js ROUTINES 0x083E).
 *
 * ROLE IN THE MACHINE. Table-dispatched (no static call site) by dispatchSequencePhase1SubStepArm, the
 * inner arm table of one outer sequence mode. It runs once: it paints the screen, and on a genuine image
 * steps SEQUENCE_SUBSTEP [seen] so the next frame runs the following arm.
 *
 * THE LAYOUT. Three pieces, all queued or stamped rather than drawn directly:
 *   - flashCopyrightLine (ROM 0x0B39) asks for the copyright line in one of two colours, picked by the frame
 *     counter's low bit, so it changes colour every frame it is requested;
 *   - stampCopyrightStrip (ROM 0x0B06) stamps the four fixed pieces of the copyright caption;
 *   - nine caption requests go onto the command ring as command 1 with arguments 0, 1, 3-7, 20 and 21
 *     (names.js: "post caption commands"); the foreground's command-ring drain runs them later.
 *
 * THE CHECK. XOR of the 24 program bytes at 0x176A (COPYRIGHT_IMAGE_CHECKSUM_BASE, the start of the routine
 * paintReadoutsThenSampleWitnessOrDerail) must be 0xC9 — it is on the genuine image (checked against the ROM
 * image). A mismatch jumps to loc_08fa, a checksum-failure landing whose bytes are really data; run as code it
 * derails the machine (names.js ROUTINES 0x08FA).
 *
 * LIVE-OUT: memory.
 */

import { u8 } from "../../../core/int.js";
import { flashCopyrightLine } from "./flashCopyrightLine.js";
import { stampCopyrightStrip } from "./stampCopyrightStrip.js";
import { postCommand } from "./postCommand.js";
import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { loc_08fa } from "./loc_08fa.js";
import { COPYRIGHT_IMAGE_CHECKSUM_BASE } from "./names.js";

/** The caption command posted to the ring, D = 1, with E stepped through the arguments (ROM `ld de,0x0100`, `inc e`). */
const CAPTION_COMMAND = 1;
const CAPTION_ARGUMENTS = [0, 1, 3, 4, 5, 6, 7, 20, 21];
/** The guarded block: 24 bytes (ROM `ld b,0x18`) from 0x176A, whose XOR must come to 0xC9. */
const CHECKSUM_BLOCK = COPYRIGHT_IMAGE_CHECKSUM_BASE;
const CHECKSUM_LENGTH = 24;
const CHECKSUM_MATCH = 0xc9;

export function buildCopyrightScreenThenVerifyImage(m) {
  const { mem8 } = m;

  // Paint the screen: flashing copyright line, the fixed caption strip, then the nine caption commands
  // (the ROM posts them in two `djnz` runs, 0-1 and 3-7, then 20 and 21 singly — caption 2 is skipped).
  flashCopyrightLine(m);
  stampCopyrightStrip(m);
  for (const argument of CAPTION_ARGUMENTS) postCommand(m, CAPTION_COMMAND, argument);

  // XOR-fold the block. The ROM steps with `inc l`, not `inc hl`, so the walk stays inside the 256-byte
  // page 0x17xx; the block (0x176A-0x1781) never reaches the page end, so this only matters to be exact.
  let fold = 0;
  let low = CHECKSUM_BLOCK & 0xff;
  const page = CHECKSUM_BLOCK & (0xff << 8);
  for (let i = 0; i < CHECKSUM_LENGTH; i++) {
    fold ^= mem8[page + low];
    low = u8(low + 1);
  }

  // On a genuine image the fold matches, so the failure landing is never taken; it is a bare throw
  // that reads nothing, so the register/borrow-flag seat it once read back is dead — dropped.
  return fold !== CHECKSUM_MATCH ? loc_08fa(m) : advanceSequenceSubStep(m);
}
