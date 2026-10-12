// SPDX-License-Identifier: GPL-3.0-only
/** showCreditLine — one sequence step that refreshes the panel and caption, then reads a guard byte that is
 * BANK_LAUNCH_COOLDOWN, borrowed here as the tamper-check result the attract sequence parks there. While FREE_PLAY is set it only advances the
 * sequence's inner index; otherwise it repaints the panel from its packed-decimal count, queues one caption request,
 * then the guard decides. Zero stamps the caption strip, requests the caption line in this frame's colour, and folds
 * a twenty-byte image run into the tamper total. Nonzero jumps to 0x2E3E (ROM 2D51 `jp nz,0x2e3e`), which is a data table rather than a routine; the port raises there.
 * LIVE-OUT: memory only. */
//
// ROM 0x2D3F-0x2D61, ending in `jp 0x43e8` (sumImageBlockForTheTamperCheck); lift:
// translated/loc_2d3f.js. Grounding tag in names.js ROUTINES: [seen].
//
// ROLE IN THE MACHINE. The game's screens are run by a two-level sequence machine (outer phase,
// inner sub-step); each sub-step is an "arm" like this one, called once per frame, that either
// returns (to be run again next frame) or moves the inner index on. This arm puts the CREDIT line up:
// record 8 of the caption table at 0x0C50 is the glyph run that the tile ROM draws as C R E D I T,
// and the number beside it is CREDIT_COUNT (0xA986), the packed-decimal credit count the one- and
// two-player starts take credits off. On free play there are no credits to show, so the arm does
// nothing but step on.
//
// It is also one link of the ANTI-TAMPER chain: its tail sums a run of the program image (the
// sixteen-byte copyright caption record and the four bytes after it) and hands the total on -- sumImageBlockForTheTamperCheck ->
// parkTheImageTotalForTheTamperVerdict -> advanceSequenceUnlessImageTampered, which compares it with
// a baked-in constant and steps the sequence on only on a match; a mismatch goes to its tamper arm.
//
// LIVE-OUT: memory only -- the credit panel, the caption request ring, the copyright strip and its
// line request, and whatever the tamper chain leaves (on a genuine image, the sequence stepped on).

import { advanceSequenceSubStep } from "./advanceSequenceSubStep.js";
import { flashCopyrightLine } from "./flashCopyrightLine.js";
import { paintCreditCountPanel } from "./paintCreditCountPanel.js";
import { postCommand } from "./postCommand.js";
import { stampCopyrightStrip } from "./stampCopyrightStrip.js";
import { sumImageBlockForTheTamperCheck } from "./sumImageBlockForTheTamperCheck.js";
import { advanceSequenceUnlessTotalTampered } from "./advanceSequenceUnlessImageTampered.js";
import { BANK_LAUNCH_COOLDOWN, FREE_PLAY, COPYRIGHT_CAPTION_RECORD } from "./names.js";
import { NotImplemented } from "../../../boards/timeplt/io.js";

// postCommand pair (1, 8): command 1 is a caption request, 8 the CREDIT caption's record number
// (`ld de,0x0108` at 0x2D49).
const CAPTION_COMMAND = 1;
const CAPTION_RECORD = 8;
// The block the tamper chain sums: the twenty bytes from the copyright caption record at 0x086B
// (COPYRIGHT_CAPTION_RECORD [seen], `ld hl,0x086b` at 0x2D5A).
const BLOCK_START = COPYRIGHT_CAPTION_RECORD;
const BLOCK_BYTES = 20;

export function showCreditLine(m) {
  const { mem8 } = m;
  // Free play (FREE_PLAY, 0xA9C0 [seen]): no credit count to show, so just move the sequence's inner
  // index on (`jp nz,0x0f1a`, advanceSequenceSubStep).
  if (mem8[FREE_PLAY] !== 0) {
    advanceSequenceSubStep(m);
    return;
  }

  // Repaint the two-digit credit field from CREDIT_COUNT (paintCreditCountPanel, 0x4AFB) and queue the
  // CREDIT caption beside it.
  paintCreditCountPanel(m);
  postCommand(m, CAPTION_COMMAND, CAPTION_RECORD);
  // The guard byte. The ROM reads BANK_LAUNCH_COOLDOWN (0xA817) here and, if it is nonzero, jumps to
  // 0x2E3E -- which is not code but a sine sample table (the one scrollWorldAtTheEraPace hands to
  // velocityForHeading), i.e. a deliberate derail. There is no routine to run there, so the port
  // raises instead of guessing; a genuine image never takes this path. The step before this one,
  // advancePenRunAnimationStep, stores into this byte (0x1742) the two's-complement sum of the 34
  // bytes at 0x1748, zero on a genuine image; when the step before that (0x074B) finds 0xAD0C
  // already at 5 it moves the index on twice, and that store does not happen on that cycle.
  if (mem8[BANK_LAUNCH_COOLDOWN] !== 0) {
    throw new NotImplemented(
      "showCreditLine: the banked image checksum is not zero, so the original jumps into a table of words " +
        "that carries no routine; a genuine image never reaches this",
    );
  }

  // Guard passed: stamp the copyright strip into the display list (0x0B06), request its line in this
  // frame's flash colour (0x0B39), then tail into the tamper sum over the caption record, whose chain
  // decides whether the sequence steps on. The chain's middle links (0x07AD, 0x200C) only park the
  // total and walk an address no one reads, so the sum hands its total straight to the verdict.
  stampCopyrightStrip(m);
  flashCopyrightLine(m);
  return sumImageBlockForTheTamperCheck(m, BLOCK_START, BLOCK_BYTES, advanceSequenceUnlessTotalTampered);
}
