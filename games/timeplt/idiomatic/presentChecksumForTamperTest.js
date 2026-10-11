// SPDX-License-Identifier: GPL-3.0-only
/** presentChecksumForTamperTest — walk an address forward twice, by a wide step and then a narrow one, and hand back a
 * byte unrelated to either: the count the caller was already carrying, moved into the place a
 * result is read from. No memory is read or written, so the walked address is only an address.
 * LIVE-OUT: the walked address, and the byte handed back.
 *
 * ROM 0x200C-0x200F (frozen lift translated/loc_200c.js: `add hl,de / rst 0x18 / ld a,b / ret`).
 * Grounding: [seen] (names.js ROUTINES 0x200c).
 *
 * Role in the machine: the last link of the image tamper check reached from showCreditLine.
 * sumImageBlockForTheTamperCheck folds a run of program bytes into one total,
 * parkTheImageTotalForTheTamperVerdict moves that total into B, and
 * advanceSequenceUnlessImageTampered (0x5303) calls here and then compares the returned byte with
 * 0x67 — stepping the sequence on a match, taking the tamper arm loc_0f8d on a mismatch. Under
 * MAME every dispatch arrived with the total already correct (A = B = 0x67) and the tamper arm
 * was never taken, so on a genuine image the check always passes (names.js).
 *
 * Why the address walk exists at all is not visible from here: nothing downstream reads the
 * address it lands on (names.js: "never dereferenced by anything downstream"), so it reads as a
 * decoy that makes the routine look like a table-index helper.
 *
 * PARAMETERS: address, wideStep, narrowStep = the address and the two steps of the walk;
 * carriedTotal = the carried count handed back.
 */

import { u16 } from "../../../core/int.js";
import { offsetAddress } from "./offsetAddress.js";

export function presentChecksumForTamperTest(m, address = m.regs.hl, wideStep = m.regs.de, carriedTotal = m.regs.b, narrowStep = m.regs.a) {
  /* The walk: `add hl,de` (the wide step), then `rst 0x18` — offsetAddress, HL += A — which moves
   * it on again by the byte in A. Only address arithmetic; no fetch. */
  offsetAddress(m, u16(address + wideStep), narrowStep);
  /* The verdict: `ld a,b` puts the carried total where the caller's `cp 0x67` reads it. The
   * move is needed because the walk above clobbers A. */
  return (m.regs.a = carriedTotal);
}
