// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0ee8 — hand-optimized rewrite of the translated routine at ROM 0x0EE8,
 * proven equal to its oracle by the equivalence harness. It touches only board-render
 * scratch (0x63AB tilemap pointer, 0x63B1 vertical extent, 0x63B3 kind) and video RAM,
 * so no ram.js name is imported.
 */

/**
 * loc_0ee8 -- draw a VERTICAL strip (a ladder run).  [ROM 0x0EE8-0x0F1A]
 *
 * The record-kind>=3 arm of the board-layout renderer (loc_0e4f tails here). Kind 4+ is
 * passed straight on to entry_0f1b. Kind exactly 3 lays a vertical run in the tilemap:
 *   - a TOP cap (tile 0xB3) at the record's tilemap address (0x63AB),
 *   - then step HL down one whole tilemap row (+0x20) at a time, writing a BODY tile
 *     (0xB1) each row and decrementing the vertical extent (0x63B1) -- by 0x10 the first
 *     step, 0x08 each row after -- until the subtraction borrows,
 *   - a BOTTOM cap (tile 0xB2) on the borrowing row.
 * Then it steps DE past the record and re-enters the walk at 0x0DA7.
 *
 * The loop counter LIVES IN 0x63B1 (reloaded, decremented, stored every row), not a JS
 * local: it is inside the diffed work RAM, so its intermediate values are observable.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. A draw primitive of sub_0da7, whose call
 * graph is not provably mask-cleared on every path, so per-instruction charges are kept
 * verbatim (always correct). The `jp 0x0da7` exits are the walk back-edge -> return; kind
 * 4+ reaches entry_0f1b through m.call (the registry), matching the translation.
 */
export function loc_0ee8(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x63b3);
  m.step(0x0eeb, 13); // ld a,(0x63b3) -- kind
  regs.cp(0x03);
  m.step(0x0eed, 7);
  if (regs.fNZ) {
    m.step(0x0f1b, 10); // jp nz,0x0f1b -- kind 4+
    return m.call(0x0f1b);
  }
  m.step(0x0ef0, 10); // kind exactly 3

  regs.hl = mem.read16(0x63ab);
  m.step(0x0ef3, 16);
  regs.a = 0xb3;
  m.step(0x0ef5, 7); // top cap
  mem.write8(regs.hl, regs.a);
  m.step(0x0ef6, 7);
  regs.bc = 0x0020;
  m.step(0x0ef9, 10); // one tilemap row
  regs.addHl(regs.bc);
  m.step(0x0efa, 11);
  regs.a = mem.read8(0x63b1);
  m.step(0x0efd, 13);
  regs.sub(0x10);
  m.step(0x0eff, 7); // FIRST step

  for (;;) {
    // loc_0eff -- borrow test
    if (regs.fC) {
      m.step(0x0f14, 10); // jp c taken -- run exhausted
      regs.a = 0xb2;
      m.step(0x0f16, 7); // bottom cap
      mem.write8(regs.hl, regs.a);
      m.step(0x0f17, 7);
      regs.de = (regs.de + 1) & 0xffff;
      m.step(0x0f18, 6);
      m.step(0x0da7, 10); // jp 0x0da7 -- walk back-edge (bare jp)
      return;
    }
    m.step(0x0f02, 10);
    mem.write8(0x63b1, regs.a);
    m.step(0x0f05, 13);
    regs.a = 0xb1;
    m.step(0x0f07, 7); // body
    mem.write8(regs.hl, regs.a);
    m.step(0x0f08, 7);
    regs.bc = 0x0020;
    m.step(0x0f0b, 10);
    regs.addHl(regs.bc);
    m.step(0x0f0c, 11);
    regs.a = mem.read8(0x63b1);
    m.step(0x0f0f, 13);
    regs.sub(0x08);
    m.step(0x0f11, 7); // SUBSEQUENT step
    m.step(0x0eff, 10); // jp 0x0eff -- loop
  }
}
