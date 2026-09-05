// SPDX-License-Identifier: GPL-3.0-only
// Map a packed coordinate byte to its tilemap-VRAM cell address by shuffling its nibble fields.
// Live-outs: HL = the cell address; A = coord bits 6..5; carry = coord bit 4 (callers branch on it).
import { VRAM_BASE } from "./names.js";

export function loc_20e1(m, coord = m.regs.a) {
  const lowNibble = coord & 0x0f;
  const rot = ((lowNibble >> 2) | (lowNibble << 6)) & 0xff; // low nibble rotated right two
  const highByte = rot & 0x03;                              // address high byte (0..3)
  const lowSeed = rot & 0xc0;                               // top two bits of the low byte
  const field = (coord >> 4) & 0x07;                        // three-bit high-nibble field
  const carry = field & 0x01;                               // bit rotated out -> carry live-out
  const aOut = field >> 1;                                  // rotated field -> A live-out
  const fold = (~((field >> 1) + field + carry)) & 0x0f;    // complemented running sum, low nibble
  const low = (fold + lowSeed) & 0xff;
  const addr = VRAM_BASE + (highByte << 8) + low;
  return (m.regs.a = aOut, m.regs.fC = carry === 1, m.regs.hl = addr, addr);
}
