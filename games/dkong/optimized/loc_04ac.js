// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_04ac — hand-optimized rewrite of the translated routine at ROM 0x04AC,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. loc_04ac calls nothing (its three exits are all `ret`),
 * so it imports no callee; nor does it use a named RAM field (its one address,
 * 0x6905, is a byte inside SPRITE_BUFFER, not a named field — see below), so it
 * imports nothing at all. It is reached only through `m.call(0x04ac)` from three
 * sites in the colour-cycle tree (loc_04a3, loc_04e1, loc_04f9); the registry
 * (games/dkong/routines.js) resolves that address to this rewrite once proven.
 */

/**
 * loc_04ac -- SHARED colour-byte store + the 3-way "blink" exit.  [ROM 0x04AC-0x04BD]
 *
 *   04ac  32 05 69   ld (0x6905),a   ; publish the caller's colour byte      13t
 *   04af  cb 71      bit 6,c         ; C = frame counter (0x6390); gate blink  8t
 *   04b1  c8         ret z           ; bit6 clear -> leave it stored          11/5t  (EXIT-1)
 *   04b2  47         ld b,a          ; save the stored byte                    4t
 *   04b3  79         ld a,c          ; A = frame counter                       4t
 *   04b4  e6 07      and 0x07        ; low 3 bits (the 8-frame phase)          7t
 *   04b6  c0         ret nz          ; not an 8-frame boundary -> done        11/5t  (EXIT-2)
 *   04b7  78         ld a,b          ; restore the stored byte                 4t
 *   04b8  ee 03      xor 0x03        ; flip colour bits 0,1 (the blink)        7t
 *   04ba  32 05 69   ld (0x6905),a   ; re-store the flipped byte              13t
 *   04bd  c9         ret             ;                                        10t     (EXIT-3)
 *
 * WHAT IT DOES. The colour-cycle tree (entry_03fb -> ... -> loc_04a3) hands this
 * routine a colour/attribute byte in A and the private attract frame counter in C
 * (loaded from 0x6390 by loc_0486). It stores A into 0x6905 unconditionally, then
 * decides whether this frame is a "blink" frame:
 *   - bit 6 of C clear  (C < 0x40): no blink -- keep the byte as stored     (EXIT-1)
 *   - bit 6 set but C not a multiple of 8: no blink this frame              (EXIT-2)
 *   - bit 6 set AND C % 8 == 0 (C in {0x40,0x48,..,0x78}): flip the byte's
 *     low two colour bits (xor 0x03) and re-store it                        (EXIT-3)
 * So the low 2 colour bits of 0x6905 toggle once every 8 frames during the upper
 * half of each 128-frame counter cycle -- a slow colour blink.
 *
 * INPUTS:  A = colour byte to store; C = attract frame counter (0x6390).
 * OUTPUTS: RAM 0x6905 = A (always), re-flipped to A^0x03 on EXIT-3.
 *          Registers B/A/F are left exactly as the oracle leaves them (below).
 * 0x6905 is a byte inside SPRITE_BUFFER (0x6900) but is not a named field in its
 * own right, so -- like handler_05c6's 0x60B4/B7/BA -- it stays hex here.
 *
 * FLAGS (kept verbatim -- the unit gate compares the whole register file, F
 * included, and each exit's `ret` does NOT overwrite F, so loc_04ac's own last
 * flag op is observed at the boundary):
 *   EXIT-1  F is whatever `bit 6,c` set (Z from bit6, H=1, N=0, C preserved).
 *   EXIT-2  F is whatever `and 0x07` set (S/Z/PV from result, H=1, N=0, C=0).
 *   EXIT-3  F is whatever `xor 0x03` set (S/Z/PV from result, H=0, N=0, C=0).
 * The B and A register writes are equally observable at the boundary (EXIT-2/3
 * leave B = the stored byte, A = the derived value), so `regs.b = regs.a`,
 * `regs.a = regs.c`, and the restore are kept -- there is no dead churn to drop
 * here; every register this routine touches is compared. The regs.bit/and/xor
 * helpers reproduce the Z80 flag semantics exactly, so F matches by construction.
 *
 * LADDER STATUS -- idiomatic (named/documented), cycles kept PER-INSTRUCTION,
 * byte-identical in effect to ../translated/state0.js. ATOMICITY IS PER-CALL-PATH:
 * loc_04ac is a leaf, but every one of its callers sits under loc_197a's per-frame
 * in-game cascade (loc_197a -> entry_03fb -> ... -> loc_04a3/04e1/04f9 -> here),
 * which runs with the NMI mask ENABLED. The vblank NMI can therefore land inside
 * this routine, so its internal cycle DISTRIBUTION is observable and NOT free to
 * collapse -- every oracle m.step charge is retained (same decision, and same
 * reason, as its parent entry_03fb and loc_197a itself). Each branch's cycle TOTAL
 * (EXIT-1 32t, EXIT-2 52t, EXIT-3 80t) is asserted on clones by the branch tests.
 */
export function loc_04ac(m) {
  const { regs, mem } = m;

  // ld (0x6905),a -- publish the caller's colour byte (0x6905 is inside SPRITE_BUFFER).
  mem.write8(0x6905, regs.a);
  m.step(0x04af, 13);

  // bit 6,c -- gate the blink on bit 6 of the attract frame counter (C, from 0x6390).
  regs.bit(6, regs.c);
  m.step(0x04b1, 8);
  if (regs.fZ) {
    m.ret(11); // ret z -- bit6 clear: no blink, leave the byte as stored (EXIT-1)
    return;
  }
  m.step(0x04b2, 5); // ret z NOT taken

  // Save the stored byte, then test the counter's low 3 bits (the 8-frame phase).
  regs.b = regs.a;
  m.step(0x04b3, 4); // ld b,a
  regs.a = regs.c;
  m.step(0x04b4, 4); // ld a,c
  regs.and(0x07);
  m.step(0x04b6, 7); // and 0x07
  if (regs.fNZ) {
    m.ret(11); // ret nz -- not an 8-frame boundary: no blink this frame (EXIT-2)
    return;
  }
  m.step(0x04b7, 5); // ret nz NOT taken

  // bit6 set AND C % 8 == 0: flip colour bits 0,1 of the stored byte and re-store it.
  regs.a = regs.b;
  m.step(0x04b8, 4); // ld a,b
  regs.xor(0x03);
  m.step(0x04ba, 7); // xor 0x03 -- flip bits 0,1
  mem.write8(0x6905, regs.a);
  m.step(0x04bd, 13); // ld (0x6905),a
  m.ret(10); // ret (EXIT-3)
}
