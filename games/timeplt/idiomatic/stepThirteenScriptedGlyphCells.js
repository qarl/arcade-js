// SPDX-License-Identifier: GPL-3.0-only
/** stepThirteenScriptedGlyphCells — step thirteen cells of the character plane on by one shape each, but only where a
 * script says so. The script is walked through one shared cursor cell, a byte per plane cell, and
 * a byte of zero leaves its cell alone; the cursor is left where the walk ended rather than
 * rewound, so a caller wanting those thirteen bytes again must put it back itself. Two bits of
 * one incoming byte set the directions independently: the low bit turns the walk round, so the
 * script is read backwards and the shape steps DOWN instead of up, and the next bit decides
 * whether the plane cells are taken a row down or a row up from the one given.
 *
 * ROM 0x4A9D-0x4ACB (frozen lift translated/loc_4a9d.js). Grounding: [seen].
 *
 * Role in the machine: the shared inner step of the two scripted band drawers,
 * advanceScriptedCharPlaneBandTo2 and advanceScriptedCharPlaneBandTo4, which call it on pairs of
 * thirteen-cell runs with different direction bits. They share BAND_SCRIPT_CURSOR 0xA9F7 with it,
 * which is why the cursor is not rewound here.
 *
 * `firstCell` is the plane address of the first cell of the run (DE on the Z80); `directions` is
 * the incoming byte (C on the Z80): bit 0 = backwards/down, bit 1 = up the plane.
 *
 * LIVE-OUT: memory-only. */

import { u8, u16 } from "../../../core/int.js";
import { BAND_SCRIPT_CURSOR } from "./names.js";

// Thirteen cells per call (`ld b,0x0d`); the character plane is 0x20 cells to a row, so the next
// cell of the run is one row on (`ld de,0x0020`) or one row back (`ld de,0xffe0`).
const CELLS = 13;
const ROW = 0x20;
// The two direction bits the ROM tests with `bit 0,c` and `bit 1,c`.
const BACKWARDS = 0x01;
const TOWARD_ROW_ZERO = 0x02;

export function stepThirteenScriptedGlyphCells(m, firstCell = m.regs.de, directions = m.regs.c) {
  const { mem8, mem16 } = m;
  // Bit 0 sets both the shape step and the script's walking direction to the same sign: the ROM
  // turns its +1 into a net -1 for the shape (`dec a` twice) and for the cursor (`dec hl` twice).
  const shapeStep = (directions & BACKWARDS) !== 0 ? -1 : 1;
  // Bit 1 alone chooses whether the run climbs the plane or descends it.
  const rowStep = (directions & TOWARD_ROW_ZERO) !== 0 ? -ROW : ROW;
  let cell = firstCell;
  for (let i = 0; i < CELLS; i++) {
    // The cursor is re-read from its RAM cell on every pass (`ld hl,(0xa9f7)`), and the script byte
    // it points at decides this cell: non-zero means step the cell's character code by one, so the
    // glyph shown there advances (or retreats) one shape; zero leaves it alone.
    const cursor = mem16[BAND_SCRIPT_CURSOR];
    if (mem8[cursor] !== 0) mem8[cell] = u8(mem8[cell] + shapeStep);
    // Move to the next cell of the run, a row down or up.
    cell = u16(cell + rowStep);
    // Advance the script cursor one byte in the walking direction and store it back, so it is left
    // where the walk ended.
    mem16[BAND_SCRIPT_CURSOR] = u16(cursor + shapeStep);
  }
}
