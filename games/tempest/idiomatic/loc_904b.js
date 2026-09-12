// SPDX-License-Identifier: GPL-3.0-only
import { u16 } from "../../../core/int.js";
import { loc_202, loc_29, loc_2a, loc_2b, loc_121, loc_122, loc_68, loc_69, loc_5f, loc_5b, loc_5d, loc_115, loc_5, loc_0, loc_3d, loc_102, loc_114 } from "./names.js";
import { loc_9749 } from "./loc_9749.js";

// Fold the sign-extended scroll delta into the long accumulator, step the 16-bit
// position by a fixed stride, flag it when the high byte saturates, and on a matched
// high difference rebuild the position seeds before delegating the spinner update.
export function loc_904b(m, y = m.regs.y) {
  const { mem8 } = m;
  mem8[loc_202] = 0x10;

  // Sign-extend the raw delta across low/mid/high work bytes.
  mem8[loc_29] = 0x00;
  mem8[loc_2b] = 0x00;
  mem8[loc_2a] = mem8[loc_121];
  if (mem8[loc_121] & 0x80) mem8[loc_2b] = 0xff;

  // Arithmetic-shift the mid:low pair right twice, preserving the sign.
  for (let i = 0; i < 2; i++) {
    const hi = mem8[loc_2a];
    mem8[loc_2a] = (hi >> 1) | (hi & 0x80);
    mem8[loc_29] = (mem8[loc_29] >> 1) | ((hi & 1) << 7);
  }

  // 24-bit accumulate the work bytes into the running total.
  let s = mem8[loc_29] + mem8[loc_122];
  mem8[loc_122] = s;
  s = mem8[loc_2a] + mem8[loc_68] + (s >> 8);
  mem8[loc_68] = s;
  s = mem8[loc_2b] + mem8[loc_69] + (s >> 8);
  mem8[loc_69] = s;

  // 16-bit position += fixed stride; flag on high-byte saturation.
  let p = mem8[loc_5f] + 0x18;
  mem8[loc_5f] = p;
  p = mem8[loc_5b] + (p >> 8);
  mem8[loc_5b] = p;
  if (mem8[loc_5b] >= 0xfc) mem8[loc_115] = 0x01;

  // High difference against the target; a zero difference rebuilds the seeds.
  const borrow = mem8[loc_5f] >= mem8[loc_5d] ? 1 : 0;
  const highDiff = mem8[loc_5b] === 0 ? 0 : (mem8[loc_5b] - 0xff - (1 - borrow)) & 0xff;
  if (highDiff === 0) {
    mem8[loc_5f] = mem8[loc_5d];
    mem8[loc_5b] = 0xff;
    mem8[loc_0] = mem8[loc_5] & 0x80 ? 0x04 : 0x08;
    mem8[u16(loc_102 + mem8[loc_3d])] = 0x00;
  }

  mem8[loc_114] = 0xff;
  return loc_9749(m, y);
}
