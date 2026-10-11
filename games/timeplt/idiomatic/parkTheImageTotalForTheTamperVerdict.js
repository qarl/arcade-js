// SPDX-License-Identifier: GPL-3.0-only
/** parkTheImageTotalForTheTamperVerdict — park the running total where the verdict arm reads it, then hand on by
 * transfer: the original moves it from the accumulator to B, out of the way of the address arithmetic that
 * clobbers the accumulator on the way to the verdict. The walked-off pointer rides along untouched.
 *
 * ROM 0x07AD-0x07B0 (lift: translated/loc_07ad.js): two instructions, `ld b,a` then `jp 0x5303`.
 * Grounding: [seen] (names.js ROUTINES 0x07AD).
 *
 * ROLE IN THE MACHINE. One link of the program-image tamper check, a chain named end to end:
 * sumImageBlockForTheTamperCheck (0x43E8) folds a block of the image into an eight-bit total and
 * jumps here; this entry hands on to advanceSequenceUnlessImageTampered (0x5303), which steps the
 * attract sequence on the one genuine total and springs the tamper trap on any other. In the ROM
 * the verdict's helper (0x200C) runs `add hl,de` and `rst 0x18`, the second of which clobbers A, and ends
 * with `ld a,b` -- which is why the total must be parked in B here first. Nothing is read or
 * written and no flag moves.
 *
 * PARAMETERS: total = the folded eight-bit total (the ROM's A); pointer = the fold's pointer, left
 * one past the block (HL); offset = the DE the chain carries into the verdict's address walk. All
 * pass straight through -- the total twice, as the count the verdict hands back (B) and as the
 * walk's narrow step (the A the ROM still holds at 0x200C).
 * LIVE-OUT: the verdict arm's memory and return. */

import { advanceSequenceUnlessImageTampered } from "./advanceSequenceUnlessImageTampered.js";

export function parkTheImageTotalForTheTamperVerdict(m, total = m.regs.a, pointer = m.regs.hl, offset = m.regs.de) {
  /* The whole routine: the register move has no counterpart once the total is an argument, so
   * all that is left is the transfer. The verdict's own exits are this entry's exits too. */
  return advanceSequenceUnlessImageTampered(m, total, pointer, offset, total);
}
