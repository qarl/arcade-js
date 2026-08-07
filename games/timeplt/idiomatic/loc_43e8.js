// SPDX-License-Identifier: GPL-3.0-only
/** loc_43e8 — add a run of bytes together and hand the total on to the routine this entry
 * transfers into, reached by a jump so that routine's own return carries this one. The run is
 * walked forward from a pointer; the length means a full 256 when it is zero and the total wraps
 * at eight bits. Nothing is written and nothing is compared: this entry produces a number, and
 * what is made of it belongs to the chain. The flags the additions leave are not reproduced.
 * LIVE-OUT: memory, whatever the chain writes; plus the total and the pointer, handed on. */

import { u8, u16 } from "../../../core/int.js";

const LENGTH_ZERO_MEANS = 256;
const CONTINUATION = 0x07ad;

export function loc_43e8(m, base = m.regs.hl, length = m.regs.b) {
  const { regs, mem8 } = m;
  const run = length === 0 ? LENGTH_ZERO_MEANS : length;
  let total = 0;
  for (let i = 0; i < run; i++) total = u8(total + mem8[u16(base + i)]);
  regs.a = total;
  regs.hl = u16(base + run);
  regs.b = 0;
  return m.call(CONTINUATION);
}
