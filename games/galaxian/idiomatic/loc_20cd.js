// SPDX-License-Identifier: GPL-3.0-only
// Paints a 3-cell tilemap column from HL stepping by DE: top cell = code+1, then two fixed tiles.
// Afterwards, only when B bit 4 is clear and the gate cell is zero, clears the status flag cell.
import { u16 } from "../../../core/int.js";
import { loc_4006, loc_40ab } from "./names.js";

const TILE_MID = 0x25; // middle-row tile
const TILE_BOTTOM = 0x20; // bottom-row tile
const HIDE_BIT = 0x10; // B bit 4: when set, leave the status flag alone

export function loc_20cd(m, code = m.regs.a, dest = m.regs.hl, stride = m.regs.de, flags = m.regs.b) {
  const { mem8 } = m;

  let cell = dest;
  mem8[cell] = code + 1; // top cell: incremented char code
  cell = u16(cell + stride);
  mem8[cell] = TILE_MID;
  cell = u16(cell + stride);
  mem8[cell] = TILE_BOTTOM;

  if (flags & HIDE_BIT) return;
  if (mem8[loc_4006] !== 0) return;
  mem8[loc_40ab] = 0; // clear the status flag
}
