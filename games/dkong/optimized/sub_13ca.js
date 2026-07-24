// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_13ca — hand-optimized rewrite of the translated routine at ROM 0x13CA,
 * proven equal to its oracle by the equivalence harness. It works the score-display /
 * high-score buffer (0x61A5-0x61CA, unnamed in ram.js), so those stay hex.
 */

/**
 * sub_13ca -- format a score and insertion-sort it into the high-score table.  [ROM 0x13CA-0x141D]
 *
 * Two callers. A is the entry index, HL points at the 3-byte packed (BCD) score.
 *   - Store A at 0x61C6, then rst 0x08 -- a skip-capable guard: if bit 0 of 0x6007 is set it
 *     aborts back to the caller (the sub_0008 false convention).
 *   - ldir the 3 score bytes to 0x61C7.
 *   - BCD UNPACK (x3): each score byte becomes two digit nibbles (high via rrca x4 + and
 *     0x0F, then low via re-read + and 0x0F) written forward from 0x61B1 -- 6 digits.
 *   - Pad with 14 blank tiles (0x10) and a 0x3F terminator.
 *   - INSERTION SORT (up to 5 passes) from 0x61A5 / 0x61C7: a 3-byte multi-precision
 *     subtract (sub then sbc, sbc) compares the candidate against the table entry; on borrow
 *     (candidate smaller) it stops (ret c); otherwise it SWAPS the two 25-byte records
 *     backward, steps both pointers back 11, and continues -- a bubble-up into the table.
 *
 * The four rrca are explicit (not a loop); `sbc a,(hl)` chains the borrow across the three
 * bytes; the 25-byte swap preserves the outer count via push/pop bc.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Two call paths, not all provably mask-cleared;
 * the rst guard is reached through m.call and its skip-boolean is honored.
 */
export function sub_13ca(m) {
  const { regs, mem } = m;

  regs.de = 0x61c6;
  m.step(0x13cd, 10);
  mem.write8(regs.de, regs.a); // store the A parameter
  m.step(0x13ce, 7);

  m.push16(0x13cf); // rst 0x08 pushes its return address
  m.step(0x0008, 11);
  if (!m.call(0x0008)) return; // SKIP: bit0 of 0x6007 set -> aborted to caller

  regs.de = (regs.de + 1) & 0xffff; // DE = 0x61C7
  m.step(0x13d0, 6);
  regs.bc = 0x0003;
  m.step(0x13d3, 10);
  m.ldir(0x13d5); // copy 3 bytes HL(param) -> 0x61C7. Leaves DE=0x61CA, HL=src+3

  // -- BCD unpack (x3): each source byte -> high nibble then low nibble --
  regs.b = 0x03;
  m.step(0x13d7, 7);
  regs.hl = 0x61b1;
  m.step(0x13da, 10);
  do {
    regs.de = (regs.de - 1) & 0xffff;
    m.step(0x13db, 6);
    regs.a = mem.read8(regs.de);
    m.step(0x13dc, 7);
    regs.rrca(); m.step(0x13dd, 4); // four explicit rrca -- NOT a loop
    regs.rrca(); m.step(0x13de, 4);
    regs.rrca(); m.step(0x13df, 4);
    regs.rrca(); m.step(0x13e0, 4);
    regs.and(0x0f); // high nibble
    m.step(0x13e2, 7);
    mem.write8(regs.hl, regs.a);
    m.step(0x13e3, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x13e4, 6);
    regs.a = mem.read8(regs.de); // re-read
    m.step(0x13e5, 7);
    regs.and(0x0f); // low nibble
    m.step(0x13e7, 7);
    mem.write8(regs.hl, regs.a);
    m.step(0x13e8, 7);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x13e9, 6);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x13da : 0x13eb, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  // -- fill 14 blanks (0x10) then a 0x3F terminator --
  regs.b = 0x0e;
  m.step(0x13ed, 7);
  do {
    mem.write8(regs.hl, 0x10);
    m.step(0x13ef, 10);
    regs.hl = (regs.hl + 1) & 0xffff;
    m.step(0x13f0, 6);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x13ed : 0x13f2, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);
  mem.write8(regs.hl, 0x3f);
  m.step(0x13f4, 10);

  // -- insertion sort: up to 5 passes --
  regs.b = 0x05;
  m.step(0x13f6, 7);
  regs.hl = 0x61a5;
  m.step(0x13f9, 10);
  regs.de = 0x61c7;
  m.step(0x13fc, 10);
  for (;;) {
    // 3-byte multi-precision subtract (de[] - hl[])
    regs.a = mem.read8(regs.de); m.step(0x13fd, 7);
    regs.sub(mem.read8(regs.hl)); m.step(0x13fe, 7); // sets borrow
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x13ff, 6);
    regs.de = (regs.de + 1) & 0xffff; m.step(0x1400, 6);
    regs.a = mem.read8(regs.de); m.step(0x1401, 7);
    regs.sbc(mem.read8(regs.hl)); m.step(0x1402, 7); // carry chain
    regs.hl = (regs.hl + 1) & 0xffff; m.step(0x1403, 6);
    regs.de = (regs.de + 1) & 0xffff; m.step(0x1404, 6);
    regs.a = mem.read8(regs.de); m.step(0x1405, 7);
    regs.sbc(mem.read8(regs.hl)); m.step(0x1406, 7);
    if (regs.fC) { m.ret(11); return; } // ret c -- candidate smaller, stop
    m.step(0x1407, 5);

    // swap 25 bytes backward, preserving the outer count
    m.push16(regs.bc); // save outer B=5
    m.step(0x1408, 11);
    regs.b = 0x19;
    m.step(0x140a, 7);
    do {
      regs.c = mem.read8(regs.hl); m.step(0x140b, 7);
      regs.a = mem.read8(regs.de); m.step(0x140c, 7);
      mem.write8(regs.hl, regs.a); m.step(0x140d, 7);
      regs.a = regs.c; m.step(0x140e, 4);
      mem.write8(regs.de, regs.a); m.step(0x140f, 7);
      regs.hl = (regs.hl - 1) & 0xffff; m.step(0x1410, 6);
      regs.de = (regs.de - 1) & 0xffff; m.step(0x1411, 6);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x140a : 0x1413, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);

    regs.bc = 0xfff5; // -11
    m.step(0x1416, 10);
    regs.addHl(regs.bc); // HL -= 11
    m.step(0x1417, 11);
    regs.exDeHl(); m.step(0x1418, 4);
    regs.addHl(regs.bc); // the other pointer -= 11
    m.step(0x1419, 11);
    regs.exDeHl(); m.step(0x141a, 4);
    regs.bc = m.pop16(); // restore outer B
    m.step(0x141b, 10);
    regs.djnz();
    if (regs.b !== 0) { m.step(0x13fc, 13); continue; }
    m.step(0x141d, 8);
    m.ret();
    return;
  }
}
