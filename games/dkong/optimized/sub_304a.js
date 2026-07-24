// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_304a — hand-optimized rewrite of the translated routine at ROM 0x304A,
 * proven equal to its oracle by the equivalence harness. It touches the screen-effect index
 * 0x638E (unnamed) and drives sub_3064 over two VRAM rows; no ram.js name is imported.
 */

/**
 * sub_304a -- run the sub_3064 row effect over two tilemap rows by index.  [ROM 0x304A-0x3063]
 *
 * Two callers. It reads the effect index at 0x638E into BC (B forced to 0), sets DE = -0x20
 * (sub_3064 subtracts one tilemap row via `add hl,de`), then calls sub_3064 twice -- once
 * from HL = 0x7600 and once from HL = 0x75C0 -- with BC and DE preserved across the pair.
 * Finally it decrements the index at 0x638E. A two-row screen effect stepped by the index.
 *
 * CYCLES -- PER-INSTRUCTION, not collapsed. Two call paths, not all provably mask-cleared;
 * the call scaffolding is kept and sub_3064 routes through m.call (the registry).
 */
export function sub_304a(m) {
  const { regs, mem } = m;

  regs.de = 0xffe0; // -0x20; sub_3064's `add hl,de` subtracts one tilemap row
  m.step(0x304d, 10);
  regs.a = mem.read8(0x638e);
  m.step(0x3050, 13);
  regs.c = regs.a;
  m.step(0x3051, 4);
  regs.b = 0x00; // BC = the index, B forced to 0
  m.step(0x3053, 7);
  regs.hl = 0x7600;
  m.step(0x3056, 10);

  m.push16(0x3059);
  m.step(0x3064, 17);
  m.call(0x3064); // preserves BC and DE

  regs.hl = 0x75c0;
  m.step(0x305c, 10);

  m.push16(0x305f);
  m.step(0x3064, 17);
  m.call(0x3064); // reuses BC and DE preserved across the first

  regs.hl = 0x638e;
  m.step(0x3062, 10);
  mem.write8(regs.hl, regs.dec8(mem.read8(regs.hl)), 8); // dec (hl) -- RMW, work RAM
  m.step(0x3063, 11);

  m.ret(); // 0x3063
}
