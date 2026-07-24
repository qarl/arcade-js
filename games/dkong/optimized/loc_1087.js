// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_1087 — hand-optimized rewrite of the translated routine at ROM 0x1087,
 * proven equal to its oracle by the equivalence harness. A board-setup coordinator over
 * the shared fill helpers plus inline fills and direct sprite writes; it names no work RAM.
 */

/**
 * loc_1087 -- board-3 (75m / elevators) sprite-and-object setup.  [ROM 0x1087-0x1120]
 *
 * rst-0x28 table entry 3: the per-board setup sub_0f56 dispatches to for BOARD == 3.
 *   - sub_122a (ROM 0x3DEC -> 0x6407, B=5, C=0x1C), sub_1186 (fill 0x6507 / gather 0x6980),
 *   - inline fill: 6 cells of 0x01 from 0x6600, stride 0x10,
 *   - inline fill (2 outer passes, HL RESET to 0x660D each pass so both write the same 3
 *     cells with 0x08, stride 0x10),
 *   - sub_11ec (ROM 0x3E64 -> 0x6603, B=6, C=0x0E),
 *   - sub_122a (ROM 0x3E60 -> 0x6607, B=6, C=0x0C),
 *   - sub_11d3 gather from IX=0x6600 into 0x6958 (B=6, DE=0x10),
 *   - ldir 0x0C bytes 0x3E48 -> 0x6A0C,
 *   - IX=0x6400; ten direct sprite writes (two records at +0/+0x20, fields +3/+5/+e/+f/...),
 *   - ldir 0x10 bytes ROM 0x1121 -> 0x6970,
 *   - ret.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Reached via the board-setup dispatch, whose
 * atomicity is not pinned to the mask-cleared NMI; callees route through m.call.
 */
export function loc_1087(m) {
  const { regs, mem } = m;

  regs.hl = 0x3dec;
  m.step(0x108a, 10);
  regs.de = 0x6407;
  m.step(0x108d, 10);
  regs.bc = 0x051c;
  m.step(0x1090, 10);
  m.push16(0x1093);
  m.step(0x122a, 17);
  m.call(0x122a);

  m.push16(0x1096);
  m.step(0x1186, 17);
  m.call(0x1186);

  // inline fill: 6 cells of 0x01 from 0x6600, stride 0x10.
  regs.hl = 0x6600;
  m.step(0x1099, 10);
  regs.de = 0x0010;
  m.step(0x109c, 10);
  regs.a = 0x01;
  m.step(0x109e, 7);
  regs.b = 0x06;
  m.step(0x10a0, 7);
  do {
    mem.write8(regs.hl, regs.a);
    m.step(0x10a1, 7);
    regs.addHl(regs.de);
    m.step(0x10a2, 11);
    regs.djnz();
    m.step(regs.b !== 0 ? 0x10a0 : 0x10a4, regs.b !== 0 ? 13 : 8);
  } while (regs.b !== 0);

  // inline fill: 2 outer passes; HL reset to 0x660D each pass -> both write the same 3
  // cells with 0x08 (stride 0x10).
  regs.c = 0x02;
  m.step(0x10a6, 7);
  regs.a = 0x08;
  m.step(0x10a8, 7);
  do {
    regs.b = 0x03;
    m.step(0x10aa, 7);
    regs.hl = 0x660d;
    m.step(0x10ad, 10);
    do {
      mem.write8(regs.hl, regs.a);
      m.step(0x10ae, 7);
      regs.addHl(regs.de);
      m.step(0x10af, 11);
      regs.djnz();
      m.step(regs.b !== 0 ? 0x10ad : 0x10b1, regs.b !== 0 ? 13 : 8);
    } while (regs.b !== 0);
    regs.a = 0x08;
    m.step(0x10b3, 7);
    regs.c = regs.dec8(regs.c);
    m.step(0x10b4, 4);
    m.step(regs.fNZ ? 0x10a8 : 0x10b7, 10);
  } while (regs.fNZ);

  regs.hl = 0x3e64;
  m.step(0x10ba, 10);
  regs.de = 0x6603;
  m.step(0x10bd, 10);
  regs.bc = 0x060e;
  m.step(0x10c0, 10);
  m.push16(0x10c3);
  m.step(0x11ec, 17);
  m.call(0x11ec);

  regs.hl = 0x3e60;
  m.step(0x10c6, 10);
  regs.de = 0x6607;
  m.step(0x10c9, 10);
  regs.bc = 0x060c;
  m.step(0x10cc, 10);
  m.push16(0x10cf);
  m.step(0x122a, 17);
  m.call(0x122a);

  regs.ix = 0x6600;
  m.step(0x10d3, 14);
  regs.hl = 0x6958;
  m.step(0x10d6, 10);
  regs.b = 0x06;
  m.step(0x10d8, 7);
  regs.de = 0x0010;
  m.step(0x10db, 10);
  m.push16(0x10de);
  m.step(0x11d3, 17);
  m.call(0x11d3);

  regs.hl = 0x3e48;
  m.step(0x10e1, 10);
  regs.de = 0x6a0c;
  m.step(0x10e4, 10);
  regs.bc = 0x000c;
  m.step(0x10e7, 10);
  m.ldir(0x10e9);

  // ten direct sprite writes to two records at IX=0x6400 (+0/+0x20).
  regs.ix = 0x6400;
  m.step(0x10ed, 14);
  const R = (d) => (regs.ix + d) & 0xffff;
  mem.write8(R(0x00), 0x01);
  m.step(0x10f1, 19);
  mem.write8(R(0x03), 0x58);
  m.step(0x10f5, 19);
  mem.write8(R(0x0e), 0x58);
  m.step(0x10f9, 19);
  mem.write8(R(0x05), 0x80);
  m.step(0x10fd, 19);
  mem.write8(R(0x0f), 0x80);
  m.step(0x1101, 19);
  mem.write8(R(0x20), 0x01);
  m.step(0x1105, 19);
  mem.write8(R(0x23), 0xeb);
  m.step(0x1109, 19);
  mem.write8(R(0x2e), 0xeb);
  m.step(0x110d, 19);
  mem.write8(R(0x25), 0x60);
  m.step(0x1111, 19);
  mem.write8(R(0x2f), 0x60);
  m.step(0x1115, 19);

  regs.de = 0x6970;
  m.step(0x1118, 10);
  regs.hl = 0x1121;
  m.step(0x111b, 10);
  regs.bc = 0x0010;
  m.step(0x111e, 10);
  m.ldir(0x1120);

  m.ret(); // 0x1120
}
