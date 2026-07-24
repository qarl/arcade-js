// SPDX-License-Identifier: GPL-3.0-only
/**
 * entry_0f1b — hand-optimized rewrite of the translated routine at ROM 0x0F1B,
 * proven equal to its oracle by the equivalence harness. It touches only board-render
 * scratch (0x63AB tilemap pointer, 0x63B1 extent, 0x63B3 kind, 0x63B5 fill tile) and
 * video RAM, so no ram.js name is imported.
 */

/**
 * entry_0f1b -- fill a vertical strip with a kind-selected tile (record kinds 4/5/6).
 * [ROM 0x0F1B-0x0F55]
 *
 * The kind>=4 tail of the board-layout renderer (loc_0ee8 delegates here). The record
 * kind (0x63B3) picks the fill tile-code and kinds >=7 are a no-op:
 *   - kind 4 -> 0xE0,  kind 5 -> 0xB0,  kind 6 (default) -> 0xFE
 *   - kind >= 7 -> bail: step DE past the record and re-enter the walk at 0x0DA7.
 * The chosen tile is stashed in 0x63B5, then a do-while column fill runs from the
 * record's tilemap address (0x63AB, loaded ONCE before the loop): write the tile, step
 * HL one whole tilemap row (+0x20), decrement the extent (0x63B1) by 8, and repeat while
 * the subtraction does NOT borrow. Then step DE past the record and re-enter the walk.
 *
 * `cp 0x07 / jp p` at 0x0F20 is a SIGN test (kind>=7), transcribed as fP -- not a
 * carry/nc test. The loop counter LIVES IN 0x63B1 (reloaded/decremented/stored each row),
 * so its intermediate values stay observable; HL is NOT reloaded inside the loop.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. A draw primitive of sub_0da7, whose call
 * graph is not provably mask-cleared on every path, so per-instruction charges are kept
 * verbatim (always correct). The `jp 0x0da7` exits are the walk back-edge -> return.
 */
export function entry_0f1b(m) {
  const { regs, mem } = m;

  regs.a = mem.read8(0x63b3);
  m.step(0x0f1e, 13); // ld a,(0x63b3) -- record kind
  regs.cp(0x07);
  m.step(0x0f20, 7);
  if (regs.fP) {
    // jp p,0x0ecf -- kind >= 7 (SIGN test)
    m.step(0x0ecf, 10);
    regs.de = (regs.de + 1) & 0xffff;
    m.step(0x0ed0, 6);
    m.step(0x0da7, 10); // jp 0x0da7 -- walk back-edge
    return;
  }
  m.step(0x0f23, 10);

  regs.cp(0x04);
  m.step(0x0f25, 7);
  if (regs.fZ) {
    m.step(0x0f4c, 10); // jp z,0x0f4c -- kind 4
    regs.a = 0xe0;
    m.step(0x0f4e, 7);
    m.step(0x0f2f, 10); // jp 0x0f2f
  } else {
    m.step(0x0f28, 10);
    regs.cp(0x05);
    m.step(0x0f2a, 7);
    if (regs.fZ) {
      m.step(0x0f51, 10); // jp z,0x0f51 -- kind 5
      regs.a = 0xb0;
      m.step(0x0f53, 7);
      m.step(0x0f2f, 10); // jp 0x0f2f
    } else {
      m.step(0x0f2d, 10); // kind 6 (default)
      regs.a = 0xfe;
      m.step(0x0f2f, 7);
    }
  }

  // loc_0f2f -- common fill body; A = fill tile-code. HL loaded ONCE, outside the loop.
  mem.write8(0x63b5, regs.a);
  m.step(0x0f32, 13);
  regs.hl = mem.read16(0x63ab);
  m.step(0x0f35, 16);

  do {
    regs.a = mem.read8(0x63b5);
    m.step(0x0f38, 13);
    mem.write8(regs.hl, regs.a);
    m.step(0x0f39, 7);
    regs.bc = 0x0020;
    m.step(0x0f3c, 10); // one tilemap row
    regs.addHl(regs.bc);
    m.step(0x0f3d, 11);
    regs.a = mem.read8(0x63b1);
    m.step(0x0f40, 13);
    regs.sub(0x08);
    m.step(0x0f42, 7);
    mem.write8(0x63b1, regs.a);
    m.step(0x0f45, 13);
    m.step(regs.fNC ? 0x0f35 : 0x0f48, 10); // jp nc,0x0f35 -- loop while no borrow
  } while (regs.fNC);

  regs.de = (regs.de + 1) & 0xffff;
  m.step(0x0f49, 6);
  m.step(0x0da7, 10); // jp 0x0da7 -- walk back-edge
  return;
}
