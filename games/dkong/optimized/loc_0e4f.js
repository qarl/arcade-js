// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0e4f — hand-optimized rewrite of the translated routine at ROM 0x0E4F,
 * proven equal to its oracle by the equivalence harness. It touches only board-render
 * scratch (0x63AB/0x63AF/0x63B1/0x63B2/0x63B3/0x63B5, currently unnamed) and video RAM,
 * so no ram.js name is imported.
 */

/**
 * loc_0e4f -- draw a slanted (diagonal) board element.  [ROM 0x0E4F-0x0ED2]
 *
 * The record-kind>=2 arm of the board-layout renderer (loc_0dd3 jumps here on `jp p`).
 * If the kind is exactly 2 it runs a small state machine that walks the run cell by
 * cell, laying the base tile (0x63B5, seeded from 0x63AF+0xF0) and, every 32 columns
 * (the `l & 0x1F == 0` page-wrap tests), stepping HL by 0x1F to the next tilemap row and
 * nudging the tile code so the element SLANTS — climbing (`inc`) or, when the x-delta
 * (0x63B2 bit 7) is negative, descending (`dec`), wrapping the tile code at the 0xF0/0xF8
 * boundaries. It advances the vertical extent 0x63B1 by 8 each row until it borrows, then
 * steps DE past the record and re-enters the walk at 0x0DA7. For kind 3 or more it tails
 * to loc_0ee8 (strip drawer / entry_0f1b).
 *
 * The `at` variable names the ROM block about to run; each assignment mirrors a `jp` in
 * the listing (the translation's faithful model of the routine's internal jumps).
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. A draw primitive of sub_0da7, whose call
 * graph is not provably mask-cleared on every path, so the per-instruction charges are
 * kept verbatim (always correct). The `jp 0x0da7` tail is a bare charge (no push) and
 * loc_0ee8 is reached through m.call (the registry), matching the translation.
 */
export function loc_0e4f(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x63b3);
  m.step(0x0e52, 13);
  regs.cp(0x02);
  m.step(0x0e54, 7);
  if (regs.fNZ) {
    m.step(0x0ee8, 10); // jp nz -- kind 3 or more
    return m.call(0x0ee8);
  }
  m.step(0x0e57, 10);

  regs.a = mem.read8(0x63af);
  m.step(0x0e5a, 13);
  regs.add(0xf0);
  m.step(0x0e5c, 7);
  mem.write8(0x63b5, regs.a);
  m.step(0x0e5f, 13);
  regs.hl = mem.read16(0x63ab);
  m.step(0x0e62, 16);

  let at = 0x0e62;
  for (;;) {
    if (at === 0x0e62) {
      regs.a = mem.read8(0x63b5);
      m.step(0x0e65, 13);
      mem.write8(regs.hl, regs.a);
      m.step(0x0e66, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0e67, 6);
      regs.a = regs.l;
      m.step(0x0e68, 4);
      regs.and(0x1f);
      m.step(0x0e6a, 7);
      if (regs.fZ) { m.step(0x0e78, 10); at = 0x0e78; continue; }
      m.step(0x0e6d, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0e70, 13);
      regs.cp(0xf0);
      m.step(0x0e72, 7);
      if (regs.fZ) { m.step(0x0e78, 10); at = 0x0e78; continue; }
      m.step(0x0e75, 10);
      regs.sub(0x10);
      m.step(0x0e77, 7);
      mem.write8(regs.hl, regs.a);
      m.step(0x0e78, 7);
      at = 0x0e78;
      continue;
    }

    if (at === 0x0e78) {
      regs.bc = 0x001f;
      m.step(0x0e7b, 10);
      regs.addHl(regs.bc);
      m.step(0x0e7c, 11);
      regs.a = mem.read8(0x63b1);
      m.step(0x0e7f, 13);
      regs.sub(0x08);
      m.step(0x0e81, 7);
      if (regs.fC) { m.step(0x0ecf, 10); at = 0x0ecf; continue; }
      m.step(0x0e84, 10);
      mem.write8(0x63b1, regs.a);
      m.step(0x0e87, 13);
      regs.a = mem.read8(0x63b2);
      m.step(0x0e8a, 13);
      regs.cp(0x00);
      m.step(0x0e8c, 7);
      if (regs.fZ) { m.step(0x0e62, 10); at = 0x0e62; continue; }
      m.step(0x0e8f, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0e92, 13);
      mem.write8(regs.hl, regs.a);
      m.step(0x0e93, 7);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0e94, 6);
      regs.a = regs.l;
      m.step(0x0e95, 4);
      regs.and(0x1f);
      m.step(0x0e97, 7);
      if (regs.fZ) { m.step(0x0ea0, 10); at = 0x0ea0; continue; }
      m.step(0x0e9a, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0e9d, 13);
      regs.sub(0x10);
      m.step(0x0e9f, 7);
      mem.write8(regs.hl, regs.a);
      m.step(0x0ea0, 7);
      at = 0x0ea0;
      continue;
    }

    if (at === 0x0ea0) {
      regs.bc = 0x001f;
      m.step(0x0ea3, 10);
      regs.addHl(regs.bc);
      m.step(0x0ea4, 11);
      regs.a = mem.read8(0x63b1);
      m.step(0x0ea7, 13);
      regs.sub(0x08);
      m.step(0x0ea9, 7);
      if (regs.fC) { m.step(0x0ecf, 10); at = 0x0ecf; continue; }
      m.step(0x0eac, 10);
      mem.write8(0x63b1, regs.a);
      m.step(0x0eaf, 13);
      regs.a = mem.read8(0x63b2);
      m.step(0x0eb2, 13);
      const neg = regs.bit(7, regs.a); // x-delta negative -> slant the other way
      m.step(0x0eb4, 8);
      if (neg) { m.step(0x0ed3, 10); at = 0x0ed3; continue; }
      m.step(0x0eb7, 10);
      regs.a = mem.read8(0x63b5);
      m.step(0x0eba, 13);
      regs.a = regs.inc8(regs.a);
      m.step(0x0ebb, 4);
      mem.write8(0x63b5, regs.a);
      m.step(0x0ebe, 13);
      regs.cp(0xf8);
      m.step(0x0ec0, 7);
      if (regs.fNZ) { m.step(0x0ec9, 10); at = 0x0ec9; continue; }
      m.step(0x0ec3, 10);
      regs.hl = (regs.hl + 1) & 0xffff;
      m.step(0x0ec4, 6);
      regs.a = 0xf0;
      m.step(0x0ec6, 7);
      mem.write8(0x63b5, regs.a);
      m.step(0x0ec9, 13);
      at = 0x0ec9;
      continue;
    }

    if (at === 0x0ec9) {
      regs.a = regs.l;
      m.step(0x0eca, 4);
      regs.and(0x1f);
      m.step(0x0ecc, 7);
      if (regs.fNZ) { m.step(0x0e62, 10); at = 0x0e62; continue; }
      m.step(0x0ecf, 10);
      at = 0x0ecf;
      continue;
    }

    if (at === 0x0ed3) {
      regs.a = mem.read8(0x63b5);
      m.step(0x0ed6, 13);
      regs.a = regs.dec8(regs.a);
      m.step(0x0ed7, 4);
      mem.write8(0x63b5, regs.a);
      m.step(0x0eda, 13);
      regs.cp(0xf0);
      m.step(0x0edc, 7);
      if (regs.fP) { m.step(0x0ee5, 10); at = 0x0ee5; continue; }
      m.step(0x0edf, 10);
      regs.hl = (regs.hl - 1) & 0xffff;
      m.step(0x0ee0, 6);
      regs.a = 0xf7;
      m.step(0x0ee2, 7);
      mem.write8(0x63b5, regs.a);
      m.step(0x0ee5, 13);
      at = 0x0ee5;
      continue;
    }

    if (at === 0x0ee5) {
      m.step(0x0e62, 10); // jp 0x0e62
      at = 0x0e62;
      continue;
    }

    // loc_0ecf -- step past the record and re-enter the walk at 0x0DA7 (bare jp).
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0ed0, 6);
    m.step(0x0da7, 10);
    return;
  }
}
