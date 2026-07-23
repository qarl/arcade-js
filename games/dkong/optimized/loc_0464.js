// SPDX-License-Identifier: GPL-3.0-only
/**
 * loc_0464 — hand-optimized rewrite of the translated routine at ROM 0x0464,
 * proven equal to its oracle by the equivalence harness.
 *
 * One routine per file. Every callee (0x004e the sprite-block copier, 0x0486 the
 * colour-attribute tail, 0x0450 the 0x6227 bit-dispatch) is reached through
 * `m.call(0xADDR)` via the routine registry (games/dkong/routines.js), so each
 * resolves to the oracle — or to its own optimized rewrite once one exists —
 * never a copy. No RAM names are imported: every address this routine touches
 * (0x6390, 0x6391, 0x6393) is deliberately UNNAMED in ram.js, so it stays hex.
 */

/**
 * loc_0464 -- counter-wrap RESET of the colour-cycle animation tree.
 * [ROM 0x0464-0x0477; HOT arm tail-jumps loc_0486, COLD arm calls sub_004e then
 *  rejoins loc_0450]
 *
 *   0464  af         xor a            ; A = 0
 *   0465  77         ld  (hl),a       ; (0x6390) = 0   -- HL == 0x6390 on entry
 *   0466  23         inc hl           ; HL -> 0x6391
 *   0467  77         ld  (hl),a       ; (0x6391) = 0
 *   0468  3a 93 63   ld  a,(0x6393)
 *   046b  a7         and a
 *   046c  c2 86 04   jp  nz,0x0486    ; 0x6393 != 0 -> colour tail (HOT)
 *   046f  21 5c 38   ld  hl,0x385c    ; 0x6393 == 0 arm (COLD)
 *   0472  cd 4e 00   call 0x004e      ; reload the sprite-object block from ROM 0x385c
 *   0475  c3 50 04   jp  0x0450       ; backward rejoin (NOT a loop)
 *
 * WHAT IT DOES. This is one leaf of entry_03fb's per-frame colour-cycle / sprite
 * animation tree (ROM 0x03FB-0x0513, driven every frame of board 1 by loc_197a).
 * loc_0426 keeps a private frame counter at 0x6390 and jumps here the frame it
 * `inc`s to 0x80 (128). loc_0464 clears that counter AND its companion latch
 * 0x6391 back to 0 (so the whole ~128-frame cycle restarts), then dispatches on a
 * mode byte 0x6393:
 *   - 0x6393 != 0  (HOT, the observed natural arm on board 1): tail-jump into the
 *     colour-attribute tail loc_0486 — the same tail every other arm of loc_0426 /
 *     loc_0450 reaches. HL is left at 0x6391; loc_0486 re-reads (0x6390) itself.
 *   - 0x6393 == 0  (COLD): point HL at the ROM template 0x385c and CALL sub_004e,
 *     which block-copies that template into the sprite-object block (0x6908-0x692F,
 *     SPRITE_OBJ_BLOCK), then `jp 0x0450` rejoins the 0x6227 bit-dispatch. This is a
 *     BACKWARD rejoin to a sibling in the same tree, not a loop back into loc_0464.
 *
 * INPUTS: HL == 0x6390 on entry (the only caller, loc_0426 @0x0426, holds it there
 *   from its `ld hl,0x6390`); reads mode byte (0x6393). OUTPUTS: writes 0 to both
 *   (0x6390) and (0x6391); the COLD arm additionally has sub_004e overwrite the
 *   40-byte sprite-object block at 0x6908. Leaves HL = 0x6391 (HOT) / 0x385c (COLD).
 *
 * NAMES. 0x6390 / 0x6391 (the private counter + latch) and 0x6393 (the mode byte)
 * are all in ram.js's deliberately-UNNAMED list — engine/animation scratch with no
 * settled cross-routine meaning — so they stay hex. 0x385c is a ROM data address,
 * not RAM. There is nothing here to name.
 *
 * FLAGS. Nothing downstream consumes a flag loc_0464 sets for its own sake: on
 * both arms the very next thing is a tail-call (loc_0486 / sub_004e -> loc_0450)
 * that re-derives every flag it uses, and loc_0426's caller does not branch on
 * loc_0464's return-flag. BUT the unit gate compares the whole register file incl.
 * F, and (being interruptible, below) a mid-routine NMI would push AF into diffed
 * stack RAM — so A, F and HL must equal the oracle's bit-for-bit at every step.
 * The routine therefore reproduces the oracle's operations verbatim: `xor a` (A=0,
 * flags), `and a` on (0x6393) (the flags the `jp nz` and the tail-call inherit).
 * So F matches automatically at every instruction boundary and at each m.call.
 *
 * ATOMIC? NO -- kept PER-INSTRUCTION (no cycle collapse). Per the ATOMICITY-IS-
 * PER-CALL-PATH rule: loc_0464's only caller loc_0426 is reached from loc_0413 <-
 * entry_03fb <- loc_197a, the interruptible per-frame main-loop cascade (NMI mask
 * ENABLED). The vblank NMI can land inside this routine (it spans the sub_004e
 * block copy and the entire loc_0486 / loc_0450 colour subtree on its tail), so its
 * internal cycle DISTRIBUTION is observable and every oracle m.step charge is
 * retained exactly. Same decision (and reason) as entry_03fb, loc_197a and
 * handler_01c3. Branch cycle TOTALs, asserted equal on clones by the unit test:
 * HOT 322 t, COLD 1745 t. This rung buys names + structure + docs, not fewer ops.
 */
export function loc_0464(m) {
  const { regs, mem } = m;

  // Clear the private frame counter (0x6390) and its companion latch (0x6391).
  // HL == 0x6390 on entry (loc_0426 holds it there); write via HL, then inc to 0x6391.
  regs.xor(regs.a);
  m.step(0x0465, 4); // xor a -- A = 0
  mem.write8(regs.hl, regs.a);
  m.step(0x0466, 7); // ld (hl),a -- (0x6390) = 0
  regs.hl = (regs.hl + 1) & 0xffff;
  m.step(0x0467, 6); // inc hl -> 0x6391
  mem.write8(regs.hl, regs.a);
  m.step(0x0468, 7); // ld (hl),a -- (0x6391) = 0

  // Dispatch on the mode byte (0x6393).
  regs.a = mem.read8(0x6393);
  m.step(0x046b, 13); // ld a,(0x6393)
  regs.and(regs.a);
  m.step(0x046c, 4); // and a

  if (regs.fNZ) {
    // 0x6393 != 0 (HOT): tail-jump into the colour-attribute tail. HL == 0x6391.
    m.step(0x0486, 10); // jp nz,0x0486
    return m.call(0x0486);
  }

  // 0x6393 == 0 (COLD): reload the sprite-object block from ROM template 0x385c,
  // then rejoin the 0x6227 bit-dispatch at loc_0450 (a backward rejoin, not a loop).
  m.step(0x046f, 10); // jp nz NOT taken
  regs.hl = 0x385c;
  m.step(0x0472, 10); // ld hl,0x385c (ROM data address)
  m.push16(0x0475); m.step(0x004e, 17); m.call(0x004e); // call 0x004e -- block copy
  m.step(0x0450, 10); // jp 0x0450
  return m.call(0x0450);
}
