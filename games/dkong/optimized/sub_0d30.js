// SPDX-License-Identifier: GPL-3.0-only
/**
 * sub_0d30 — hand-optimized rewrite of the translated routine at ROM 0x0D30,
 * proven equal to its oracle by the equivalence harness. No RAM name is imported:
 * its stores land in video RAM (0x74xx-0x77xx), which is not ram.js's domain.
 */

/**
 * sub_0d30 -- the shared two-band VRAM filler.  [ROM 0x0D30-0x0D42]
 *
 *   0d30  06 11        ld   b,0x11        ; 17 cells
 *   0d32  36 fd  ...   ld (hl),0xfd / inc hl / djnz 0x0d32   ; fill band 1 = 0xFD
 *   0d37  11 0f 00     ld   de,0x000f
 *   0d3a  19           add  hl,de         ; step over the 15-cell middle gap
 *   0d3b  06 11        ld   b,0x11
 *   0d3d  36 fc  ...   ld (hl),0xfc / inc hl / djnz 0x0d3d   ; fill band 2 = 0xFC
 *   0d42  c9           ret
 *
 * WHAT IT DOES. Given HL at a row base, stamps a fixed decoration into two 17-cell
 * bands: 0xFD across [HL .. HL+16], then (after skipping the 15-cell centre via
 * `add hl,de` with DE=0x0F) 0xFC across [HL+32 .. HL+48]. Both loop counts are the
 * immediate 0x11 — there is NO data-dependent branch, so exactly one execution path.
 *
 * INPUTS : HL (the caller-supplied row base). OUTPUTS: video RAM only; HL left at
 *   base+49, B=0, DE=0x000F, F from the final `add hl,de` (the last flag-affecting
 *   op — `djnz` and the 16-bit `inc`/writes set no flags).
 *
 * Called only by sub_0d27 (0x0D27), twice: a real `call 0x0d30` then a fall-through
 * tail. sub_0d27 is reached only from loc_0cf2 (the 75m arm of the board-setup
 * cascade), dispatched by dispatchGameState INSIDE the vblank NMI (mask cleared).
 *
 * ATOMIC — cycles COLLAPSED, total preserved. sub_0d30 runs only inside the
 * mask-cleared NMI (its sole caller sub_0d27 does), and it is a leaf (calls nothing),
 * so the vblank NMI can never land inside it. Its internal distribution is therefore
 * unobservable and collapses to one lump. TOTAL, re-derived per-instruction:
 *   band 1 = ld b(7) + 17*(ld 10 + inc 6) + 16*djnz13 + 1*djnz8 = 7+272+208+8 = 495
 *   middle = ld de(10) + add hl,de(11) = 21 ;  band 2 = 495 ;  ret = 10
 *   => 495 + 21 + 495 + 10 = 1021 t, preserved exactly (feeds the NMI cost -> the
 *   main-loop spin count, README §2). No 0x7Dxx latch is written (plain VRAM), so a
 *   full collapse is safe with no write-trace to preserve.
 */
export function sub_0d30(m) {
  const { regs, mem } = m;

  // band 1: 17 cells of 0xFD from HL.
  regs.b = 0x11;
  do {
    mem.write8(regs.hl, 0xfd);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.djnz();
  } while (regs.b);

  // step over the 15-cell middle gap (DE = 0x000F; add hl,de sets the exit flags).
  regs.de = 0x000f;
  regs.addHl(regs.de);

  // band 2: 17 cells of 0xFC.
  regs.b = 0x11;
  do {
    mem.write8(regs.hl, 0xfc);
    regs.hl = (regs.hl + 1) & 0xffff;
    regs.djnz();
  } while (regs.b);

  m.ret(1021); // atomic: the whole routine's 1021 t collapsed to the return.
}
