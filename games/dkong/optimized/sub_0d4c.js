// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0d4c — hand-optimized rewrite of the translated routine at ROM 0x0D4C,
 * proven equal to its oracle by the equivalence harness. Stores land in video RAM,
 * so there is no ram.js name to import.
 */

/**
 * sub_0d4c -- the shared two-band 4-cell VRAM filler.  [ROM 0x0D4C-0x0D5E]
 *
 *   0d4c  06 04        ld   b,0x04                            ; 4 cells
 *   0d4e  36 fd  ...   ld (hl),0xfd / inc hl / djnz 0x0d4e    ; band 1 = 0xFD
 *   0d54  11 1c 00     ld   de,0x001c
 *   0d57  19           add  hl,de                             ; step over the 28-cell gap
 *   0d59  06 04        ld   b,0x04
 *   0d5b  36 fc  ...   ld (hl),0xfc / inc hl / djnz 0x0d59    ; band 2 = 0xFC
 *   0d5e  c9           ret
 *
 * The 4-cell twin of sub_0d30: given HL at a row base, stamp 0xFD across 4 cells,
 * skip the 28-cell centre (DE=0x1C), then 0xFC across 4 cells. Both loop counts are
 * the immediate 0x04 — no data-dependent branch, one path. Called only by sub_0d43,
 * twice (real call then fall-through), on the 100m board-4 setup path (mask-cleared NMI).
 *
 * OUTPUTS: video RAM only; HL left at base+36, B=0, DE=0x001C, F from the final
 * `add hl,de` (djnz and the 16-bit inc/writes set no flags).
 *
 * ATOMIC — cycles COLLAPSED. Runs only inside the mask-cleared NMI (its caller sub_0d43
 * does) and is a leaf, so the NMI never lands inside it. TOTAL re-derived:
 *   band = ld b(7) + 4*(ld 10 + inc 6) + 3*djnz13 + 1*djnz8 = 7+64+39+8 = 118
 *   middle = ld de(10) + add(11) = 21 ;  2*band + middle + ret10 = 118+21+118+10 = 267 t.
 * VRAM only, no 0x7Dxx latch -> full collapse, no write-trace.
 */
export function sub_0d4c(m) {
  const { regs, mem } = m;

  // band 1: 4 cells of 0xFD from HL.
  regs.b = 0x04;
  do {
    mem.write8(regs.hl, 0xfd);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.djnz();
  } while (regs.b);

  // step over the 28-cell gap (DE = 0x001C; add hl,de sets the exit flags).
  regs.de = 0x001c;
  regs.addHl(regs.de);

  // band 2: 4 cells of 0xFC.
  regs.b = 0x04;
  do {
    mem.write8(regs.hl, 0xfc);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.djnz();
  } while (regs.b);

  m.ret(267); // atomic: the whole routine's 267 t collapsed to the return.
}
