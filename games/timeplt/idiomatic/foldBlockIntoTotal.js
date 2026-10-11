// SPDX-License-Identifier: GPL-3.0-only
/** foldBlockIntoTotal — add a run of bytes into a total the caller has already started. The Z80 also walked a
 * SECOND pointer alongside it a byte at a time, overwriting one byte-sized holder at each step, and
 * left that holder, both pointers and the spent count standing in registers; the second walk
 * contributes nothing to the total and nothing after the call reads any of what it left, so it
 * is not repeated here. The second pointer is still accepted, so the call keeps the shape its
 * callers use; the holder's prior value (C) is not, since nothing here or after it reads it. The length arrives as a count that means a full 256
 * when it is zero, and the total wraps at eight bits. Nothing is written.
 * LIVE-OUT: the total, returned and left standing in A, as the ROM leaves it.
 * ROM 0x291E-0x2926. Grounding: [seen] (names.js ROUTINES 0x291E). */

import { u8, u16 } from "../../../core/int.js";

const LENGTH_ZERO_MEANS = 256;

export function foldBlockIntoTotal(m, running = m.regs.a, sumFrom = m.regs.hl, walkFrom = m.regs.de, length = m.regs.b) {
  const { mem8 } = m;
  const run = length === 0 ? LENGTH_ZERO_MEANS : length;
  let total = running;
  for (let i = 0; i < run; i++) total = u8(total + mem8[u16(sumFrom + i)]);
  return (m.regs.a = total);
}
