// SPDX-License-Identifier: GPL-3.0-only
// Bit-packer: reads bit 0 of 128 flag bytes and packs them LSB-first into a 16-byte bitmap at
// the destination pointer. Returns the pointer advanced past the 16 bytes (a live-out the caller
// chains into a block copy).
import { u16 } from "../../../core/int.js";
import { FLAG_BITS_BASE } from "./names.js";

export function loc_0764(m, dst = m.regs.de) {
  const { mem8 } = m;

  let src = FLAG_BITS_BASE;
  for (let byte = 0; byte < 16; byte++) {
    let packed = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (mem8[src] & 0x01) packed |= 1 << bit;
      src++;
    }
    mem8[dst + byte] = packed;
  }

  return (m.regs.de = u16(dst + 16));
}
