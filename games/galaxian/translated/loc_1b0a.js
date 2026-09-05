// SPDX-License-Identifier: GPL-3.0-only

// loc_1b0a  (ROM 0x1B0A-0x1B12) — set up the exx-based strided VRAM copy. Point HL at the VRAM
// destination 0x5233, load the column stride BC=0x0020, then stash both in the shadow set with `exx`
// and load B=0x07 as the (main-set) row counter. DE already holds the source table (set by the caller
// at 0x1b04/0x1b51). Falls through into the copy loop at loc_1b13. The two register banks split the job:
// the shadow set carries the copy pointers HL'/BC'/DE', the main set carries the djnz counter B.
//   1b0a  21 33 52  ld hl,0x5233
//   1b0d  01 20 00  ld bc,0x0020
//   1b10  d9        exx
//   1b11  06 07     ld b,0x07
export function loc_1b0a(m) {
  const { regs, mem } = m;

  regs.hl = 0x5233;
  m.step(0x1b0d, 10); // ld hl,0x5233 -- VRAM copy destination

  regs.bc = 0x0020;
  m.step(0x1b10, 10); // ld bc,0x0020 -- column stride (add hl,bc per row)

  regs.exx();
  m.step(0x1b11, 4); // exx -- park HL'/BC' (=0x5233/0x0020) + DE' (source) in the shadow set

  regs.b = 0x07;
  m.step(0x1b13, 7); // ld b,0x07 -- main-set row counter (7 rows)

  // fall-through into loc_1b13 (the strided-copy loop) -- delegate, do not inline
  return m.call(0x1b13);
}
