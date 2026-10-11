// SPDX-License-Identifier: GPL-3.0-only
/**
 * stampGridBox — stamp a block of four fixed character codes at the cursor: two into the pair of cells
 * the cursor names, and two into the pair in the next native row, which is thirty-two
 * addresses on. The four codes are constants chosen here, so this reads nothing and lays down the
 * same block wherever it is pointed, and the cursor is left exactly where it was found.
 *
 * ROM 0x00C7-0x00D7 (frozen lift translated/loc_00c7.js). Grounding: [seen].
 *
 * Role in the machine: the four codes decode through the tile ROM as the corners of one hollow
 * box — top-left, top-right, and the two matching bottom halves — laid two cells across and two
 * rows down in the character plane. Its only caller is tileCharPlaneWithBoxLattice, which runs it
 * once per box across fourteen bands of sixteen to tile a power-on lattice over the plane; the
 * boot wipe erases that lattice before the attract sequence begins, so it is not a gameplay
 * background.
 *
 * `cursor` is the plane address of the box's first cell (the Z80 held it in HL, and saved and
 * restored it with push/pop so the caller's cursor survives the call).
 *
 * LIVE-OUT: memory, plus the step from the second cell to the third, left in an address pair.
 */

// The character plane is thirty-two cells to a row, so the cell directly beneath one is 32
// addresses on. From the SECOND cell of the top pair the ROM reaches the first of the bottom
// pair by adding 0x1F (`ld de,0x001f; add hl,de`), which is what it leaves standing in DE.
const NEXT_CELL = 32;
const SECOND_TO_THIRD = NEXT_CELL - 1;

// The four box-corner character codes the ROM stores (0x56, 0x83, 0xC7, 0xEF).
const FIRST_CODE = 86;
const SECOND_CODE = 131;
const THIRD_CODE = 199;
const FOURTH_CODE = 239;

export function stampGridBox(m, cursor = m.regs.hl) {
  const { mem8 } = m;
  // Top pair of cells: the box's top edge with its left and right corners.
  mem8[cursor] = FIRST_CODE;
  mem8[cursor + 1] = SECOND_CODE;
  // Bottom pair, one row further on: the two matching bottom halves, closing the rectangle.
  mem8[cursor + NEXT_CELL] = THIRD_CODE;
  mem8[cursor + NEXT_CELL + 1] = FOURTH_CODE;
  return (m.regs.de = SECOND_TO_THIRD); // DE carries this step to the caller (load-bearing live-out)
}
