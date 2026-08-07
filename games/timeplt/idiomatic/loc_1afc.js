// SPDX-License-Identifier: GPL-3.0-only
/** loc_1afc — copy one character cell's glyph byte and its colour byte into a two-byte record.
 * The two planes hold the same grid at the same offset and are told apart by a single address
 * bit, so one pointer reaches both. The cell is left alone. LIVE-OUT: memory. */

import { u16 } from "../../../core/int.js";

const GLYPH_PLANE_BIT = 0x0400;

export function loc_1afc(m, cell = m.regs.hl, record = m.regs.de) {
  const { mem8 } = m;
  mem8[record] = mem8[cell];
  mem8[u16(record + 1)] = mem8[cell & ~GLYPH_PLANE_BIT];
}
