// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0da7 — hand-optimized rewrite of the translated routine at ROM 0x0DA7,
 * proven equal to its oracle by the equivalence harness. It touches only board-render
 * scratch (0x63AB/0x63AF/0x63B3/0x63B4, currently unnamed) and reaches VRAM through its
 * draw-primitive callees, so no ram.js name is imported.
 */

/**
 * sub_0da7 -- the board-layout table walker.  [ROM 0x0DA7-0x0DA6 loop]
 *
 * Walks a ROM layout table (pointed to by DE) one record at a time and draws the board.
 * Each record starts with a kind byte (stored to 0x63B3); the value 0xAA terminates the
 * walk. Otherwise it reads the record's two coordinate bytes into B/C, calls sub_2ff0
 * (0x2FF0) to resolve the tilemap start pointer (saved to 0x63AB, with DE preserved
 * across the call), derives the sub-tile phases 0x63B4 = B & 7 and 0x63AF = C & 7, reads
 * the length byte and (via `sub b`, negating on borrow) sets up the run, then dispatches
 * loc_0dd3 to decode+draw the record. loc_0dd3's chain ends by returning here (the ROM's
 * `jp 0x0da7` tail becomes a JS return up the call stack), so the `for(;;)` continues to
 * the next record.
 *
 * INPUTS : DE (layout table cursor), C (running column base). OUTPUTS: the drawn board
 *   (video RAM, via loc_0dd3/loc_0e19/loc_0e2a/loc_0e4f); 0x63AB/0x63AF/0x63B3/0x63B4
 *   left holding the last record's fields. Returns when the 0xAA terminator is hit.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. sub_0da7 is called from many sites,
 * including the intro/how-high steppers loc_17b6/loc_1880 whose dispatch is not pinned
 * to the mask-cleared NMI, so atomicity is not provable on every path; the
 * per-instruction charges are kept verbatim (always correct). The `ret z` terminator and
 * the `call 0x2ff0` / `call 0x0dd3` scaffolding are modelled exactly as the translation;
 * all callees are reached through m.call (the registry).
 */
export function sub_0da7(m) {
  const { regs, mem } = m;

  for (;;) {
    // record kind -> 0x63B3; 0xAA ends the walk.
    regs.a = mem.read8(regs.de);
    m.step(0x0da8, 7);
    mem.write8(0x63b3, regs.a);
    m.step(0x0dab, 13);
    regs.cp(0xaa);
    m.step(0x0dad, 7);
    if (regs.fZ) {
      m.ret(11); // ret z -- terminator
      return;
    }
    m.step(0x0dae, 5);

    // two coordinate bytes -> H/B and L/C.
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0daf, 6);
    regs.a = mem.read8(regs.de);
    m.step(0x0db0, 7);
    regs.h = regs.a;
    m.step(0x0db1, 4);
    regs.b = regs.h;
    m.step(0x0db2, 4);
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0db3, 6);
    regs.a = mem.read8(regs.de);
    m.step(0x0db4, 7);
    regs.l = regs.a;
    m.step(0x0db5, 4);
    regs.c = regs.l;
    m.step(0x0db6, 4);

    // resolve the tilemap start pointer via sub_2ff0 (DE saved) -> 0x63AB.
    m.push16(regs.de);
    m.step(0x0db7, 11);
    m.push16(0x0dba);
    m.step(0x2ff0, 17);
    m.call(0x2ff0);
    regs.de = m.pop16();
    m.step(0x0dbb, 10);
    mem.write16(0x63ab, regs.hl);
    m.step(0x0dbe, 16);

    // sub-tile phases: 0x63B4 = B & 7, 0x63AF = C & 7.
    regs.a = regs.b;
    m.step(0x0dbf, 4);
    regs.and(0x07);
    m.step(0x0dc1, 7);
    mem.write8(0x63b4, regs.a);
    m.step(0x0dc4, 13);
    regs.a = regs.c;
    m.step(0x0dc5, 4);
    regs.and(0x07);
    m.step(0x0dc7, 7);
    mem.write8(0x63af, regs.a);
    m.step(0x0dca, 13);

    // length byte -> H; H -= B, negate on borrow (make the run length positive).
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0dcb, 6);
    regs.a = mem.read8(regs.de);
    m.step(0x0dcc, 7);
    regs.h = regs.a;
    m.step(0x0dcd, 4);
    regs.sub(regs.b);
    m.step(0x0dce, 4);
    if (regs.fNC) {
      m.step(0x0dd3, 10); // jp nc taken
    } else {
      m.step(0x0dd1, 10); // jp nc not taken (jp cc is 10 either way)
      regs.neg();
      m.step(0x0dd3, 8); // neg is ED-prefixed
    }

    // decode + draw this record; loc_0dd3's chain returns here to continue the walk.
    m.call(0x0dd3);
  }
}
