// SPDX-License-Identifier: GPL-3.0-only
/** sumImageBlockForTheTamperCheck — add a run of bytes together and hand the total on to the routine this entry
 * transfers into, reached by a jump so that routine's own return carries this one. The run is
 * walked forward from a pointer; the length means a full 256 when it is zero and the total wraps
 * at eight bits. Nothing is written and nothing is compared: this entry produces a number, and
 * what is made of it belongs to the chain. The flags the additions leave are not reproduced.
 * The chain is entered by a direct call, as the original jumps into it, so this entry performs no return of
 * its own and pops no slot; `handOn` is that continuation, the parking step of the tamper verdict unless
 * a caller names another, and it takes the total and the walked-off pointer as arguments -- the pair the
 * original leaves in its accumulator and pointer for the chain. LIVE-OUT: memory, whatever the chain
 * writes; the chain's return.
 * ROM 0x43E8-0x43EF. Grounding: [seen] (names.js ROUTINES 0x43E8). */

import { u8, u16 } from "../../../core/int.js";
import { parkTheImageTotalForTheTamperVerdict } from "./parkTheImageTotalForTheTamperVerdict.js";

const LENGTH_ZERO_MEANS = 256;

export function sumImageBlockForTheTamperCheck(m, base = m.regs.hl, length = m.regs.b, handOn = parkTheImageTotalForTheTamperVerdict) {
  const { mem8 } = m;
  const run = length === 0 ? LENGTH_ZERO_MEANS : length;
  let total = 0;
  for (let i = 0; i < run; i++) total = u8(total + mem8[u16(base + i)]);
  return handOn(m, total, u16(base + run));
}
