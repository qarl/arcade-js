// SPDX-License-Identifier: GPL-3.0-only
/** paintQuadTile — lay down one four-tile block and colour the whole of it in one go. The four cells
 * are the one the cursor names, its neighbour one address back, and the two a line-stride on from
 * those; they take four consecutive tile codes counting up from a base the caller fixes -- the
 * cursor's cell base+1, its neighbour the base, and the lower pair base+2 then base+3 -- so the
 * block is one picture cut into quarters and not four independent tiles. Each of
 * the four then gets the caller's single colour, written a fixed distance lower in the address
 * space — a subtraction, so a cursor already on the colour side is carried a further block down
 * rather than left where it is. The cursor comes out two line strides on, clear of the block just
 * written, so a caller can chain the next against it.
 * LIVE-OUT: the eight cells, and the cursor, returned. The ROM also leaves a colour pointer in HL,
 * which its one caller never reads (equivalence-0e70, DEAD AT EXIT).
 *
 * ROM: 0x0E70. Tag [seen] (names.js). Role in the machine: one of a family of block painters named by
 * block SIZE — drawSlotWithOneGlyph (one glyph beside a blank), paintDoubleTile (two cells) and this one
 * (four) — each leaving the cursor clear of what it drew: the two narrow ones one line stride on, this
 * one two. The routine that splits a value into counts of thirties, tens, fives
 * and ones calls a different painter per denomination and chains the cursor between them; this one
 * draws both the tens and the thirties, with only the base code and the colour differing.
 *
 * Parameters: `cell` is the drawing cursor in the character plane (the ROM's DE), `firstTile` the
 * block's base tile code (B), `colour` the one colour for all four cells (C). */

import { u16 } from "../../../core/int.js";

// One character row is 32 cells (the ROM's RST 0x28 adds 0x20 to DE); the colour plane sits
// 0x400 below the character plane (the ROM builds the colour pointer as DE + 0xFC00).
const LINE_STRIDE = 32;
const COLOUR_PLANE_BELOW = 1024;
const TILES = 4;

export function paintQuadTile(m, cell = m.regs.de, firstTile = m.regs.b, colour = m.regs.c) {
  const { mem8 } = m;

  // The four quarters, in the order the ROM visits them: the cursor cell, the one before it,
  // then the row below — first under the earlier cell, then under the cursor (ld (de) / dec de /
  // rst 0x28 / ld (de) / inc de / ld (de)). The codes run base+1, base, base+2, base+3, so the
  // lower-addressed cell of each row takes the lower code of that row's pair.
  const quarters = [cell, u16(cell - 1), u16(cell - 1 + LINE_STRIDE), u16(cell + LINE_STRIDE)];
  mem8[quarters[0]] = firstTile + 1;
  mem8[quarters[1]] = firstTile;
  mem8[quarters[2]] = firstTile + 2;
  mem8[quarters[3]] = firstTile + 3;
  // Colour: the same four cells a plane down, written in the reverse order (the ROM colours the
  // lower row first, then steps back up a row with RST 0x20 and colours the upper one).
  for (let i = TILES - 1; i >= 0; i--) mem8[u16(quarters[i] - COLOUR_PLANE_BELOW)] = colour;

  // Live-out: the cursor moved two rows on, clear of this block, so the next painter in the chain
  // starts from there.
  return (m.regs.de = u16(cell + 2 * LINE_STRIDE));
}
