// SPDX-License-Identifier: GPL-3.0-only
// Copy three source bytes up a video-RAM column: each byte lands at the destination, whose low
// address byte then steps up one row (-32) within the fixed page. After the three, the low byte
// advances +98 to line up the next column. Returns the advanced source pointer and destination.
import { u8, u16 } from "../../../core/int.js";

export function loc_03af(m, src = m.regs.hl, dst = m.regs.de) {
  const { mem8 } = m;

  const hi = dst >> 8; // high byte is fixed; the column walk wraps the low byte within the page
  let lo = dst & 0xff;
  let read = src;

  for (let i = 0; i < 3; i++) {
    mem8[(hi << 8) | lo] = mem8[read];
    read = u16(read + 1);
    lo = u8(lo - 32);
  }

  const nextLo = u8(lo + 98);
  return (m.regs.hl = read, m.regs.de = (hi << 8) | nextLo, m.regs.a = nextLo);
}
