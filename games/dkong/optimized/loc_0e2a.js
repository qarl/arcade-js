// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0e2a — hand-optimized rewrite of the translated routine at ROM 0x0E2A,
 * proven equal to its oracle by the equivalence harness. It touches only board-render
 * scratch (0x63B0/0x63B3/0x63AD, currently unnamed) and video RAM, so no ram.js name
 * is imported.
 */

/**
 * loc_0e2a -- finish a layout record and re-enter the table walk.  [ROM 0x0E2A-0x0E4E]
 *
 * A draw primitive of the board-layout renderer sub_0da7. It computes and stamps the
 * record's endpoint tiles, then tail-jumps back to sub_0da7 (0x0DA7) to read the next
 * record. Two sub-decisions:
 *   - 0x63B3 == 1 (a single-cell run): step back one cell (`dec l`) and stamp 0xC0,
 *     then forward again — draw the closing cell.
 *   - 0x63B0 != 0 (a sub-tile remainder): stamp one more cell whose code is
 *     (0x63B0)+0xE0 at the next position.
 * The cell base tile is (0x63B0)+0xD0, written at the pointer held in 0x63AD.
 *
 * INPUTS : 0x63B0 (span remainder), 0x63B3 (record kind), 0x63AD (tilemap write ptr),
 *          DE (layout table cursor). OUTPUTS: video RAM cells; DE advanced past the
 *          record; then control jumps to 0x0DA7.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Like its sibling loc_0e19 it is a draw
 * primitive of sub_0da7, whose call graph includes callers (loc_17b6/loc_1880) not
 * pinned to the mask-cleared NMI, so atomicity is not provable on every path and the
 * per-instruction charges are kept verbatim. The final `jp 0x0da7` is a bare charge
 * (no push/call): the walk re-enters sub_0da7's loop, matching the translation.
 */
export function loc_0e2a(m) {
  const { regs, mem } = m;

  // base tile = (0x63B0) + 0xD0, written at the pointer 0x63AD.
  regs.a = mem.read8(0x63b0);
  m.step(0x0e2d, 13);
  regs.add(0xd0);
  m.step(0x0e2f, 7);
  regs.hl = mem.read16(0x63ad);
  m.step(0x0e32, 16);
  mem.write8(regs.hl, regs.a);
  m.step(0x0e33, 7);

  // single-cell record (0x63B3 == 1): draw the closing 0xC0 one cell back.
  regs.a = mem.read8(0x63b3);
  m.step(0x0e36, 13);
  regs.cp(0x01);
  m.step(0x0e38, 7);
  if (regs.fNZ) {
    m.step(0x0e3f, 10); // jp nz taken
  } else {
    m.step(0x0e3b, 10);
    regs.l = regs.dec8(regs.l);
    m.step(0x0e3c, 4);
    mem.write8(regs.hl, 0xc0);
    m.step(0x0e3e, 10);
    regs.l = regs.inc8(regs.l);
    m.step(0x0e3f, 4);
  }

  // sub-tile remainder (0x63B0 != 0): stamp one extra cell = (0x63B0)+0xE0.
  regs.a = mem.read8(0x63b0);
  m.step(0x0e42, 13);
  regs.cp(0x00);
  m.step(0x0e44, 7);
  if (regs.fZ) {
    m.step(0x0e4b, 10); // jp z taken -- no remainder
  } else {
    m.step(0x0e47, 10);
    regs.add(0xe0);
    m.step(0x0e49, 7);
    regs.l = regs.inc8(regs.l);
    m.step(0x0e4a, 4);
    mem.write8(regs.hl, regs.a);
    m.step(0x0e4b, 7);
  }

  // step past the record and re-enter the walk at 0x0DA7 (bare jp, no push).
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0e4c, 6);
  m.step(0x0da7, 10);
}
