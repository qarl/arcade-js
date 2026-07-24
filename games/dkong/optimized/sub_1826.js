// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_1826 — hand-optimized rewrite of the translated routine at ROM 0x1826,
 * proven equal to its oracle by the equivalence harness. A generic rectangular tile fill;
 * it names no work RAM (the destination HL is the caller's).
 */

/**
 * sub_1826 -- fill a 5-wide × 14-tall tile block with 0x10.  [ROM 0x1826-0x1837]
 *
 * A screen-region fill (5 callers), destination HL supplied by the caller. It writes tile
 * 0x10 across 5 columns, then steps HL by DE = -0x25 so the next row starts one tilemap row
 * up and back at the left edge (5 written, then -0x25 = net -0x20 per row). Repeats for
 * C = 0x0E rows. The fill value 0x10 is loaded ONCE, before the outer loop.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Five call paths, not all provably mask-cleared,
 * so the charges are kept verbatim.
 */
export function sub_1826(m) {
  const { regs, mem } = m;

  regs.de = 0xffdb; // -0x25
  m.step(0x1829, 10);
  regs.c = 0x0e; // 14 rows
  m.step(0x182b, 7);
  regs.a = 0x10; // fill tile, loaded once
  m.step(0x182d, 7);

  do {
    // outer row loop
    regs.b = 0x05; // 5 columns
    m.step(0x182f, 7);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x1830, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x1831, 6);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x182f : 0x1833, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.addHl(regs.de); // HL -= 0x25 -> next row up, left edge
    m.step(0x1834, 11);
    regs.c = regs.dec8(regs.c);
    m.step(0x1835, 4);
    m.step(regs.fNZ ? 0x182d : 0x1838, 10);
  } while (regs.fNZ);

  m.ret(); // 0x1838
}
