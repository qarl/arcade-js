// SPDX-License-Identifier: GPL-3.0-only
/** loc_291e — add a run of bytes into a total the caller has already started, walking a SECOND
 * pointer alongside it a byte at a time. The second walk contributes nothing to the total: each
 * step overwrites the same byte-sized holder, so only the last byte it passes survives the loop.
 * The length arrives as a count that means a full 256 when it is zero, both pointers step in
 * lockstep, and the total wraps at eight bits. Nothing is written.
 * LIVE-OUT: the total, returned and left standing; the last byte the second walk read; both
 * pointers, each standing one past its own run; and the length counted down to nothing. */

import { u8, u16 } from "../../../core/int.js";

const LENGTH_ZERO_MEANS = 256;

export function loc_291e(
  m,
  running = m.regs.a,
  sumFrom = m.regs.hl,
  walkFrom = m.regs.de,
  length = m.regs.b,
) {
  const { regs, mem8 } = m;
  const run = length === 0 ? LENGTH_ZERO_MEANS : length;
  let total = running;
  let lastWalked = regs.c;
  for (let i = 0; i < run; i++) {
    total = u8(total + mem8[u16(sumFrom + i)]);
    lastWalked = mem8[u16(walkFrom + i)];
  }
  regs.a = total;
  regs.c = lastWalked;
  regs.hl = u16(sumFrom + run);
  regs.de = u16(walkFrom + run);
  regs.b = 0;
  return total;
}
