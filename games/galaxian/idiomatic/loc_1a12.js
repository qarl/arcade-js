// SPDX-License-Identifier: GPL-3.0-only
// Per-object contribution to a running accumulator. Skips (leaves the total untouched) unless the object
// is active and its Y sits in one of two row bands and its X delta is in range; otherwise folds the row
// band plus X-position bits into a 0-15 index, reads a signed step from the lookup table, and adds it to B.
import { loc_4202, OBJ_STEP_TABLE } from "./names.js";

export function loc_1a12(m, objPtr = m.regs.ix, objY = m.regs.h, objX = m.regs.l, objFlags = m.regs.c, total = m.regs.b) {
  const { mem8 } = m;

  // Inactive object (bit 0 of its first byte clear) contributes nothing.
  if (!(mem8[objPtr] & 0x01)) return (m.regs.b = total);

  // Y must be at least 128 and fall in the near (0) or far (1) row band; else out of range.
  const row = objY - 128;
  let band;
  if (row < 0) return (m.regs.b = total);
  if (row < 52) band = 0;
  else if (row < 104) band = 1;
  else return (m.regs.b = total);

  // Horizontal delta from the reference X; out of range once it reaches the top half.
  const delta = (mem8[loc_4202] - objX - 64) & 0xff;
  if (delta >= 128) return (m.regs.b = total);

  // Index bits: flag bit 7 and delta bits 5-6, rotated down to the low nibble, then the band in bit 0.
  const bits = (objFlags & 0x80) | (delta & 0x60);
  const index = (((bits >> 4) | (bits << 4)) & 0xff) | band;

  return (m.regs.b = (total + mem8[OBJ_STEP_TABLE + index]) & 0xff);
}
