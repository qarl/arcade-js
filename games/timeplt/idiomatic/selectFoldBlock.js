// SPDX-License-Identifier: GPL-3.0-only
/**
 * selectFoldBlock — hand back where a fixed block of the program image starts and how many bytes of it
 * to take; nothing is read and nothing is written.
 *
 * WHAT IT IS: ROM routine 0x08AE [seen]. Both values are constants chosen here, so the whole content of
 * this entry is WHICH block, and whatever a caller held in the two registers that carry them is
 * discarded. The block is thirty bytes starting at seatCaptionPenFromEraFoldingTamperIntoPhase's own
 * entry point -- that routine's CODE, read here as data.
 *
 * ROLE IN THE MACHINE: one step of the game's anti-tamper machinery. The only transfer into this
 * address is a tail jump from 0x4BD9, whose single caller loads a seed byte and then runs the summing
 * loop at 0x291E (`add a,(hl)` / `inc hl` / `djnz`, with a DE walk interleaved) over exactly this pointer and count, banking the
 * total in a cell a later sequence arm reads. Patch those thirty bytes and the total moves; this entry
 * is where the block to be summed is chosen.
 *
 * LIVE-OUT: the pair -- the block's start (the ROM leaves it in HL) and its byte count (in B).
 */

import { seatCaptionPenFromEraFoldingTamperIntoPhase_ADDR } from "./names.js";

/** The block's length: thirty bytes (the ROM's `ld b,0x1e`), the summing loop's `djnz` count. */
const BLOCK_BYTES = 30;

export function selectFoldBlock(m) {
  // Both values go back in the registers the summing loop consumes: HL is the pointer it walks, B the
  // count its `djnz` runs down; the caller reads them straight back.
  return [m.regs.hl = seatCaptionPenFromEraFoldingTamperIntoPhase_ADDR, m.regs.b = BLOCK_BYTES];
}
