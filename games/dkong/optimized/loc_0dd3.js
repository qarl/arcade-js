// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0dd3 — hand-optimized rewrite of the translated routine at ROM 0x0DD3,
 * proven equal to its oracle by the equivalence harness. It touches only board-render
 * scratch (0x63AB/0x63AD/0x63AF/0x63B0/0x63B1/0x63B2/0x63B3, currently unnamed) and
 * video RAM, so no ram.js name is imported.
 */

/**
 * loc_0dd3 -- decode one layout record and draw its endpoints.  [ROM 0x0DD3-0x0E18]
 *
 * The main draw primitive of the board-layout renderer sub_0da7. From the record kind
 * already in A (stored to 0x63B1), it reads two more layout bytes: the run LENGTH
 * (0x63B2 = byte - C) and the sub-tile phase (0x63B0 = byte & 7). It calls sub_2ff0
 * (0x2FF0) to resolve the tilemap start pointer (saved to 0x63AD), then, unless the
 * record kind is >= 2 (delegated to loc_0e4f), computes and stamps the record's first
 * two tiles (bases derived from 0x63AF via +0xF0 / -0x30) at the pointer held in
 * 0x63AB, and — for a length-1 record (0x63B3 == 1) — zeroes the run counter 0x63B2.
 * It finishes by falling into loc_0e19 (the vertical-run drawer), which walks the run
 * and tail-jumps back to sub_0da7 for the next record.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. A draw primitive of sub_0da7, whose call
 * graph includes callers (loc_17b6/loc_1880) not pinned to the mask-cleared NMI, so
 * atomicity is not provable on every path; the per-instruction charges are kept
 * verbatim (always correct). The `call 0x2ff0` keeps its push16/step scaffolding; the
 * two branch exits (`jp p 0x0e4f`, and the `call 0x0e19` fall-through) are modelled
 * exactly as the translation. All callees are reached through m.call (the registry).
 */
export function loc_0dd3(m) {
  const { regs, mem } = m;

  // record kind -> 0x63B1; run length -> 0x63B2 (byte - C); sub-tile phase -> 0x63B0.
  mem.write8(0x63b1, regs.a);
  m.step(0x0dd6, 13);
  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0dd7, 6);
  regs.a = mem.read8(regs.de);
  m.step(0x0dd8, 7);
  regs.l = regs.a;
  m.step(0x0dd9, 4);
  regs.sub(regs.c);
  m.step(0x0dda, 4);
  mem.write8(0x63b2, regs.a);
  m.step(0x0ddd, 13);
  regs.a = mem.read8(regs.de);
  m.step(0x0dde, 7);
  regs.and(0x07);
  m.step(0x0de0, 7);
  mem.write8(0x63b0, regs.a);
  m.step(0x0de3, 13);

  // resolve the tilemap start pointer via sub_2ff0 (DE saved across it) -> 0x63AD.
  m.push16(regs.de);
  m.step(0x0de4, 11);
  m.push16(0x0de7);
  m.step(0x2ff0, 17);
  m.call(0x2ff0);
  regs.de = m.pop16();
  m.step(0x0de8, 10);
  mem.write16(0x63ad, regs.hl);
  m.step(0x0deb, 16);

  // record kind >= 2 (sign/parity even by cp 0x02) -> delegate to loc_0e4f.
  regs.a = mem.read8(0x63b3);
  m.step(0x0dee, 13);
  regs.cp(0x02);
  m.step(0x0df0, 7);
  if (regs.fP) {
    m.step(0x0e4f, 10); // jp p taken
    return m.call(0x0e4f);
  }
  m.step(0x0df3, 10);

  // 0x63B2 += 0x63AF - 0x10 (adjust run length for this record kind).
  regs.a = mem.read8(0x63b2);
  m.step(0x0df6, 13);
  regs.sub(0x10);
  m.step(0x0df8, 7);
  regs.b = regs.a;
  m.step(0x0df9, 4);
  regs.a = mem.read8(0x63af);
  m.step(0x0dfc, 13);
  regs.add(regs.b);
  m.step(0x0dfd, 4);
  mem.write8(0x63b2, regs.a);
  m.step(0x0e00, 13);

  // stamp the first two endpoint tiles (0x63AF+0xF0, then that -0x30) at 0x63AB.
  regs.a = mem.read8(0x63af);
  m.step(0x0e03, 13);
  regs.add(0xf0);
  m.step(0x0e05, 7);
  regs.hl = mem.read16(0x63ab);
  m.step(0x0e08, 16);
  mem.write8(regs.hl, regs.a);
  m.step(0x0e09, 7);
  regs.l = regs.inc8(regs.l); // inc l (wraps within the page), NOT inc hl
  m.step(0x0e0a, 4);
  regs.sub(0x30);
  m.step(0x0e0c, 7);
  mem.write8(regs.hl, regs.a);
  m.step(0x0e0d, 7);

  // length-1 record (0x63B3 == 1): zero the run counter before the vertical walk.
  regs.a = mem.read8(0x63b3);
  m.step(0x0e10, 13);
  regs.cp(0x01);
  m.step(0x0e12, 7);
  if (regs.fNZ) {
    m.step(0x0e19, 10); // jp nz taken
  } else {
    m.step(0x0e15, 10);
    regs.xor(regs.a);
    m.step(0x0e16, 4);
    mem.write8(0x63b2, regs.a);
    m.step(0x0e19, 13);
  }

  // fall into loc_0e19 (the vertical-run drawer); its tail returns to our caller.
  m.call(0x0e19);
}
