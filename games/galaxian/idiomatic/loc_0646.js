// SPDX-License-Identifier: GPL-3.0-only
// Unpack a 16-byte packed bitmask at `src` into 128 one-byte-per-bit flags (LSB first), writing 1 for a
// set bit and 0 for a clear one. Returns the source pointer advanced past the 16 mask bytes, which the
// caller reads back to copy the data that follows the mask.
import { u16 } from "../../../core/int.js";
import { FLAG_BITS_BASE } from "./names.js";

export function loc_0646(m, src = m.regs.de) {
  const { mem8 } = m;

  let out = FLAG_BITS_BASE;
  for (let row = 0; row < 16; row++) {
    const packed = mem8[src];
    for (let bit = 0; bit < 8; bit++) {
      mem8[out++] = (packed >> bit) & 1;
    }
    src = u16(src + 1);
  }

  return (m.regs.de = src);
}
